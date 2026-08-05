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
    constructor(provider, adapter = new KubernetesAdapter()) {
        this.redisAdapter = new RedisAdapter('Client')
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
            // Claim that client
            const claimedClient = await this.#replaceClientStatus(OIDCClient)
            if (claimedClient?.getInstance() === this.instance) {
                OIDCClient.generateSecret()
                await this.#createKubeSecret(OIDCClient)
            }
        }
        if (OIDCClient.isDisabled()) {
            await this.redisAdapter.destroy(OIDCClient.getClientId())
        } else if (OIDCClient.hasSecret()) {
            await this.redisAdapter.upsert(OIDCClient.getClientId(), OIDCClient.toRedis())
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
        if (OIDCClient.isDisabled()) {
            await this.redisAdapter.destroy(OIDCClient.getClientId())
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
    }

    async #createKubeSecret(OIDCClient) {
        await this.adapter.createSecret(
            OIDCClient.getClientNamespace(),
            OIDCClient.getSecretName(),
            OIDCClient.toClientSecret(this.provider),
            OIDCClient.toClientSecretMetadata(),
        )
        if (OIDCClient.getSecretRefreshJob()) {
            await this.adapter.createJob(
                OIDCClient.getClientNamespace(),
                OIDCClient.getSecretRefreshJob()
            )
        }
    }

    async #patchKubeSecret(OIDCClient, existingSecret) {
        await this.adapter.patchSecret(
            OIDCClient.getClientNamespace(),
            OIDCClient.getSecretName(),
            OIDCClient.toClientSecret(this.provider),
            OIDCClient.toClientSecretMetadata(),
            existingSecret
        )
        if (OIDCClient.getSecretRefreshJob()) {
            await this.adapter.createJob(
                OIDCClient.getClientNamespace(),
                OIDCClient.getSecretRefreshJob()
            )
        }
    }

    async #deleteOIDCClient (OIDCClient) {
        this.reconcileState.unregister(OIDCClient)
        if (OIDCClient.getInstance() === this.instance) {
            await this.redisAdapter.destroy(OIDCClient.getClientId())
        }
    }
}

export default KubeOIDCClientOperator
