import OidcClient from "../models/oidc-client.js";
import {
    IngressApiGroup,
    IngressApiGroupVersion,
    IngressCrd,
    OIDCClientCrd,
    OIDCClientSecretClientSecretKey
} from "../utils/kubernetes/kube-constants.js";
import RedisAdapter from "../adapters/redis.js";
import {KubernetesAdapter} from "../adapters/kubernetes.js";
import {NamespaceFilter} from "../utils/kubernetes/namespace-filter.js";
import {getActivityTracker} from "../services/activity-tracker.js";
import {ClientReconcileState} from '../models/client-activity-state.js';
import {validateClaimMappings} from '../utils/claim-mappings.js'
import {resolveIngressRef} from '../utils/kubernetes/resolve-ingress-ref.js'

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
            this.#assertValidClaimMappings(OIDCClient)
            if (OIDCClient.getInstance() === this.instance) {
                await this.#resolveIngressRef(OIDCClient)
                if (!await this.redisAdapter.find(OIDCClient.getClientId())) {
                    await this.#reconcileClientSecret(OIDCClient)
                }
            } else if (!OIDCClient.getInstance()) {
                // Claim that client. Continue with the returned resource so later
                // status writes use the resourceVersion produced by the claim.
                const claimedClient = await this.#replaceClientStatus(OIDCClient)
                if (claimedClient?.getInstance() === this.instance) {
                    OIDCClient = claimedClient
                    // After the claim, not before: claiming rebuilds the model
                    // from the stored resource, and the resolution is in-memory
                    // only, so resolving first would be discarded here.
                    await this.#resolveIngressRef(OIDCClient)
                    await this.#reconcileClientSecret(OIDCClient)
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

    async #updateOIDCClient(OIDCClient, {force = false} = {}) {
        if (!this.reconcileState.shouldReconcile(OIDCClient) && !force) return
        if (OIDCClient.getInstance() !== this.instance) {
            if (OIDCClient.getInstance()) return
            const claimedClient = await this.#replaceClientStatus(OIDCClient)
            if (claimedClient?.getInstance() !== this.instance) return
            OIDCClient = claimedClient
        }
        try {
            this.#assertValidClaimMappings(OIDCClient)
            await this.#resolveIngressRef(OIDCClient)
            if (OIDCClient.isDisabled()) {
                await this.redisAdapter.destroy(OIDCClient.getClientId())
                await this.#reportReady(OIDCClient, 'Disabled', 'Client is disabled and absent from Redis')
                return
            }
            // Debounce the burst of MODIFIED events our own status writes
            // produce. This used to also paper over the ADDED path still
            // creating the Secret; #reconcileClientSecret no longer needs the
            // head start, since whichever reconcile gets there first wins.
            await new Promise(res => setTimeout(res, 1000));
            await this.#reconcileClientSecret(OIDCClient)
            await this.redisAdapter.upsert(OIDCClient.getClientId(), OIDCClient.toRedis())
            await this.#reportReady(OIDCClient, 'Reconciled', 'Client reconciliation completed successfully')
        } catch (error) {
            await this.#reportFailure(OIDCClient, error)
        }
    }

    // Converge on one client_secret. Reconciles of the same client overlap: the
    // watch callback is not awaited between events, so an ADDED and the
    // MODIFIED our own status write provokes can be in flight together, and
    // every replica reconciles every event because the instance identity is
    // per-Deployment, not per-Pod. Generating a secret and deleting whatever
    // was there — what this used to do — meant each reconcile installed its own
    // secret and upserted that one to Redis, so the application could end up
    // holding a secret the provider had already replaced, and authentication
    // failed with invalid_client until something reconciled again (#236).
    //
    // Whoever creates the Secret first wins; everyone else adopts it. Nothing
    // here deletes a Secret, so a client_secret is never rotated as a
    // side effect of a reconcile.
    async #reconcileClientSecret(OIDCClient) {
        const namespace = OIDCClient.getClientNamespace()
        const name = OIDCClient.getSecretName()
        const existing = await this.adapter.getSecret(namespace, name)
        if (existing) {
            return await this.#adoptKubeSecret(OIDCClient, existing)
        }
        OIDCClient.generateSecret()
        const created = await this.adapter.createSecret(
            namespace,
            name,
            OIDCClient.toClientSecret(this.provider),
            OIDCClient.toClientSecretMetadata(),
            {ignoreAlreadyExists: true},
        )
        if (created?.alreadyExists) {
            // Lost the race; take the winner's secret rather than ours.
            const secret = await this.adapter.getSecret(namespace, name)
            if (!secret) {
                throw this.#reconcileError('SecretReconcileFailed', 'Client Secret exists but could not be read')
            }
            return await this.#adoptKubeSecret(OIDCClient, secret)
        }
        if (!created) throw this.#reconcileError('SecretReconcileFailed', 'Failed to create client Secret')
        await this.#reconcileRefreshJob(OIDCClient)
    }

    async #adoptKubeSecret(OIDCClient, existingSecret) {
        OIDCClient.setSecret(existingSecret.data[OIDCClientSecretClientSecretKey])
        const secret = await this.adapter.patchSecret(
            OIDCClient.getClientNamespace(),
            OIDCClient.getSecretName(),
            OIDCClient.toClientSecret(this.provider),
            OIDCClient.toClientSecretMetadata(),
            existingSecret
        )
        if (!secret) throw this.#reconcileError('SecretReconcileFailed', 'Failed to update client Secret')
        await this.#reconcileRefreshJob(OIDCClient)
    }

    // The Job name is derived from the client's resourceVersion, so an existing
    // one means another reconcile of this same version already created it —
    // success, not the failure it used to be reported as.
    async #reconcileRefreshJob(OIDCClient) {
        if (!OIDCClient.getSecretRefreshJob()) {
            return
        }
        const job = await this.adapter.createJob(
            OIDCClient.getClientNamespace(),
            OIDCClient.getSecretRefreshJob(),
            {ignoreAlreadyExists: true},
        )
        if (!job) throw this.#reconcileError('RefreshJobReconcileFailed', 'Failed to create secret-refresh Job')
    }

    #reconcileError(reason, message) {
        return Object.assign(new Error(message), {reason})
    }

    // Refuse a mapping that names a claim Passmower owns, or one that could not
    // be put in a token, before the client reaches Redis — it would otherwise
    // reconcile normally and emit that claim on every login. The message lands
    // on the resource as Ready=False.
    #assertValidClaimMappings(OIDCClient) {
        const problems = validateClaimMappings(OIDCClient.getClaimMappings())
        if (problems.length) {
            throw this.#reconcileError(
                'InvalidClaimMappings',
                `Invalid spec.claimMappings: ${problems.join('; ')}`
            )
        }
    }

    // A client with spec.ingressRef takes its host from an Ingress in its own
    // namespace. Resolved on every reconcile and applied in memory, so nothing
    // is written back into a resource its author owns, and a changed host is
    // picked up the next time the client is reconciled — which the Ingress
    // watch asks for as soon as it sees one (#35).
    async #resolveIngressRef(OIDCClient) {
        const ingressRef = OIDCClient.getIngressRef()
        if (!ingressRef?.name) {
            return
        }
        if (process.env.INGRESS_DISCOVERY_ENABLED !== 'true') {
            throw this.#reconcileError('IngressRefUnresolved',
                'spec.ingressRef needs Ingress access: set passmower.ingressDiscovery.enabled')
        }
        const ingress = await this.adapter.getNamespacedCustomObject(
            IngressCrd,
            OIDCClient.getClientNamespace(),
            ingressRef.name,
            (obj) => obj,
            IngressApiGroup,
            IngressApiGroupVersion,
        )
        const {uri, redirectUris, problems} = resolveIngressRef(ingress, OIDCClient.getRedirectPaths())
        if (problems) {
            // Registering the client with no redirect URI would fail logins with
            // a mismatch instead; say so on the resource.
            throw this.#reconcileError('IngressRefUnresolved',
                `Cannot resolve spec.ingressRef ${ingressRef.name}: ${problems.join('; ')}`)
        }
        OIDCClient.setResolvedIngress({uri, redirectUris})
    }

    // Reconcile one client by name whatever its reconcile fingerprint says.
    // A changed Ingress host changes what a client resolves to without touching
    // the client itself, so its generation does not move and the usual
    // fingerprint check would skip it.
    async reconcileClientByName(namespace, name) {
        const client = await this.adapter.getNamespacedCustomObject(
            OIDCClientCrd, namespace, name,
            (incoming) => (new OidcClient()).fromIncomingClient(incoming))
        if (!client) {
            return false
        }
        await this.#updateOIDCClient(client, {force: true})
        return true
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
