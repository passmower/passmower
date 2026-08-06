import OidcClient from "../models/oidc-client.js";
import {
    OIDCClientCrd,
    OIDCClientSecretClientSecretKey
} from "../utils/kubernetes/kube-constants.js";
import RedisAdapter from "../adapters/redis.js";
import {KubernetesAdapter} from "../adapters/kubernetes.js";
import {NamespaceFilter} from "../utils/kubernetes/namespace-filter.js";
import {getActivityTracker} from "../services/activity-tracker.js";
import {ClientReconcileState} from '../models/client-activity-state.js';

export class KubeOIDCClientOperator {
    constructor(provider, adapter = new KubernetesAdapter(), redisAdapter = new RedisAdapter('Client')) {
        this.redisAdapter = redisAdapter
        this.provider = provider
        this.adapter = adapter
        this.instance = this.adapter.instance
        this.reconcileState = new ClientReconcileState(getActivityTracker())
    }

    async watchClients() {
        this.adapter.setWatchParameters(
            OIDCClientCrd,
            (OIDCClient) => (new OidcClient()).fromIncomingClient(OIDCClient),
            (OIDCClient) => this.#createOIDCClient(OIDCClient),
            (OIDCClient) => this.#updateOIDCClient(OIDCClient),
            (OIDCClient) => this.#deleteOIDCClient(OIDCClient),
            new NamespaceFilter(this.adapter.namespace)
        )
        await this.adapter.watchObjects()
    }

    async #createOIDCClient (OIDCClient) {
        this.reconcileState.register(OIDCClient)
        try {
            if (OIDCClient.getInstance() === this.instance) {
                if (!await this.redisAdapter.find(OIDCClient.getClientId())) {
                    let secret = await this.adapter.getSecret(
                        OIDCClient.getClientNamespace(),
                        OIDCClient.getSecretName()
                    )
                    if (secret) {
                        OIDCClient.setSecret(secret.data[OIDCClientSecretClientSecretKey])
                    } else {
                        OIDCClient.generateSecret()
                        await this.adapter.deleteSecret(
                            OIDCClient.getClientNamespace(),
                            OIDCClient.getSecretName()
                        )
                        await this.#createKubeSecret(OIDCClient)
                    }
                }
            } else if (!OIDCClient.getInstance()) {
                // Claim that client. Continue with the returned resource so later
                // status writes use the resourceVersion produced by the claim.
                const claimedClient = await this.#replaceClientStatus(OIDCClient)
                if (claimedClient?.getInstance() === this.instance) {
                    OIDCClient = claimedClient
                    OIDCClient.generateSecret()
                    await this.#createKubeSecret(OIDCClient)
                } else {
                    return
                }
            } else {
                return
            }
            if (OIDCClient.isDisabled()) {
                await this.redisAdapter.destroy(OIDCClient.getClientId())
                await this.#reportReady(OIDCClient, 'Disabled', 'Client is disabled and absent from Redis')
            } else {
                if (OIDCClient.hasSecret()) {
                    await this.redisAdapter.upsert(OIDCClient.getClientId(), OIDCClient.toRedis())
                }
                await this.#reportReady(OIDCClient, 'Reconciled', 'Client reconciliation completed successfully')
            }
        } catch (error) {
            await this.#reportFailure(OIDCClient, error)
        }
    }

    async #replaceClientStatus (OIDCClient) {
        const status = {...OIDCClient.getIntendedStatus(), instance: this.instance}
        return await this.adapter.replaceNamespacedCustomObjectStatus(
            OIDCClientCrd,
            OIDCClient.getClientNamespace(),
            OIDCClient.getClientName(),
            OIDCClient.getResourceVersion(),
            status,
            (OIDCClient) => (new OidcClient()).fromIncomingClient(OIDCClient),
        )
    }

    async #updateOIDCClient(OIDCClient) {
        if (!this.reconcileState.shouldReconcile(OIDCClient)) return
        if (OIDCClient.getInstance() !== this.instance) return
        try {
            if (OIDCClient.isDisabled()) {
                await this.redisAdapter.destroy(OIDCClient.getClientId())
                await this.#reportReady(OIDCClient, 'Disabled', 'Client is disabled and absent from Redis')
                return
            }
            await new Promise(res => setTimeout(res, 1000));
            let secret = await this.adapter.getSecret(
                OIDCClient.getClientNamespace(),
                OIDCClient.getSecretName()
            )
            if (secret) {
                OIDCClient.setSecret(secret.data[OIDCClientSecretClientSecretKey])
                await this.#patchKubeSecret(OIDCClient, secret)
            } else {
                OIDCClient.generateSecret()
                await this.adapter.deleteSecret(
                    OIDCClient.getClientNamespace(),
                    OIDCClient.getSecretName()
                )
                await this.#createKubeSecret(OIDCClient)
            }
            await this.redisAdapter.upsert(OIDCClient.getClientId(), OIDCClient.toRedis())
            await this.#reportReady(OIDCClient, 'Reconciled', 'Client reconciliation completed successfully')
        } catch (error) {
            await this.#reportFailure(OIDCClient, error)
        }
    }

    async #createKubeSecret(OIDCClient) {
        const secret = await this.adapter.createSecret(
            OIDCClient.getClientNamespace(),
            OIDCClient.getSecretName(),
            OIDCClient.toClientSecret(this.provider),
            OIDCClient.toClientSecretMetadata(),
        )
        if (!secret) throw this.#reconcileError('SecretReconcileFailed', 'Failed to create client Secret')
        if (OIDCClient.getSecretRefreshJob()) {
            const job = await this.adapter.createJob(
                OIDCClient.getClientNamespace(),
                OIDCClient.getSecretRefreshJob()
            )
            if (!job) throw this.#reconcileError('RefreshJobReconcileFailed', 'Failed to create secret-refresh Job')
        }
    }

    async #patchKubeSecret(OIDCClient, existingSecret) {
        const secret = await this.adapter.patchSecret(
            OIDCClient.getClientNamespace(),
            OIDCClient.getSecretName(),
            OIDCClient.toClientSecret(this.provider),
            OIDCClient.toClientSecretMetadata(),
            existingSecret
        )
        if (!secret) throw this.#reconcileError('SecretReconcileFailed', 'Failed to update client Secret')
        if (OIDCClient.getSecretRefreshJob()) {
            const job = await this.adapter.createJob(
                OIDCClient.getClientNamespace(),
                OIDCClient.getSecretRefreshJob()
            )
            if (!job) throw this.#reconcileError('RefreshJobReconcileFailed', 'Failed to create secret-refresh Job')
        }
    }

    #reconcileError(reason, message) {
        return Object.assign(new Error(message), {reason})
    }

    async #reportReady(OIDCClient, reason, message) {
        const changed = OIDCClient.updateReadyCondition(true, reason, message)
        const updatedClient = await this.#replaceClientStatus(OIDCClient)
        if (changed && updatedClient) {
            await this.adapter.createEvent(
                OIDCClient.getClientNamespace(), OIDCClient.getMetadata(), reason, message, 'Normal'
            )
        }
    }

    async #reportFailure(OIDCClient, error) {
        const reason = error.reason ?? 'ReconcileFailed'
        const message = error.message ?? 'Client reconciliation failed'
        const changed = OIDCClient.updateReadyCondition(false, reason, message)
        await this.#replaceClientStatus(OIDCClient)
        if (changed) {
            await this.adapter.createEvent(
                OIDCClient.getClientNamespace(), OIDCClient.getMetadata(), reason, message
            )
        }
        globalThis.logger.error({error, client: OIDCClient.getClientId()}, 'Failed to reconcile OIDCClient')
    }

    async #deleteOIDCClient (OIDCClient) {
        this.reconcileState.unregister(OIDCClient)
        if (OIDCClient.getInstance() === this.instance) {
            await this.redisAdapter.destroy(OIDCClient.getClientId())
        }
    }
}

export default KubeOIDCClientOperator
