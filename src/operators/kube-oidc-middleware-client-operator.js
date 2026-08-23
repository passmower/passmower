import RedisAdapter from "../adapters/redis.js";
import {KubernetesAdapter} from "../adapters/kubernetes.js";
import {
    OIDCMiddlewareClientCrd, spec,
    TraefikMiddleware, TraefikMiddlewareApiGroup, TraefikMiddlewareApiGroupVersion,
} from "../utils/kubernetes/kube-constants.js";
import OidcMiddlewareClient from "../models/oidc-middleware-client.js";
import {NamespaceFilter} from "../utils/kubernetes/namespace-filter.js";
import {Claimed} from "../conditions/claimed.js";
import {getActivityTracker} from '../services/activity-tracker.js';
import {ClientReconcileState} from '../models/client-activity-state.js';

export class KubeOIDCMiddlewareClientOperator {
    constructor(provider, adapter = new KubernetesAdapter(), redisAdapter = new RedisAdapter('Client')) {
        this.redisAdapter = redisAdapter
        this.provider = provider
        this.adapter = adapter
        this.instance = this.adapter.instance
        this.reconcileState = new ClientReconcileState(getActivityTracker())
    }

    async watchClients() {
        this.adapter.setWatchParameters(
            OIDCMiddlewareClientCrd,
            (OIDCMiddlewareClient) => (new OidcMiddlewareClient()).fromIncomingClient(OIDCMiddlewareClient),
            (OIDCMiddlewareClient) => this.#createOIDCClient(OIDCMiddlewareClient),
            (OIDCMiddlewareClient) => this.#updateOIDCClient(OIDCMiddlewareClient),
            (OIDCMiddlewareClient) => this.#deleteOIDCClient(OIDCMiddlewareClient),
            new NamespaceFilter(this.adapter.namespace)
        )
        await this.adapter.watchObjects()
    }

    async #createOIDCClient (OIDCMiddlewareClient) {
        this.reconcileState.register(OIDCMiddlewareClient)
        try {
            if (OIDCMiddlewareClient.getInstance() === this.instance) {
                await this.#createOrReplaceClientMiddleware(OIDCMiddlewareClient)
                if (!OIDCMiddlewareClient.isDisabled()) await this.redisAdapter.upsert(OIDCMiddlewareClient.getClientId(), OIDCMiddlewareClient.toRedis())
            } else if (!OIDCMiddlewareClient.getInstance()) {
                // Continue with the claimed resourceVersion for the readiness write.
                const claimedClient = await this.#replaceClientStatus(OIDCMiddlewareClient)
                if (claimedClient?.getInstance() === this.instance) {
                    OIDCMiddlewareClient = claimedClient
                    await this.#createOrReplaceClientMiddleware(OIDCMiddlewareClient)
                    if (!OIDCMiddlewareClient.isDisabled()) await this.redisAdapter.upsert(OIDCMiddlewareClient.getClientId(), OIDCMiddlewareClient.toRedis())
                } else {
                    return
                }
            } else {
                return
            }
            if (OIDCMiddlewareClient.isDisabled()) {
                await this.redisAdapter.destroy(OIDCMiddlewareClient.getClientId())
                await this.#reportReady(OIDCMiddlewareClient, 'Disabled', 'Client is disabled and absent from Redis')
            } else {
                await this.#reportReady(OIDCMiddlewareClient, 'Reconciled', 'Traefik Middleware and Redis record are up to date')
            }
        } catch (error) {
            await this.#reportFailure(OIDCMiddlewareClient, error)
        }
    }

    async #updateOIDCClient(OIDCMiddlewareClient) {
        if (!this.reconcileState.shouldReconcile(OIDCMiddlewareClient)) return
        if (OIDCMiddlewareClient.getInstance() !== this.instance) {
            if (OIDCMiddlewareClient.getInstance()) return
            const claimedClient = await this.#replaceClientStatus(OIDCMiddlewareClient)
            if (claimedClient?.getInstance() !== this.instance) return
            OIDCMiddlewareClient = claimedClient
        }
        try {
            if (OIDCMiddlewareClient.isDisabled()) {
                await this.redisAdapter.destroy(OIDCMiddlewareClient.getClientId())
                await this.#reportReady(OIDCMiddlewareClient, 'Disabled', 'Client is disabled and absent from Redis')
                return
            }
            await new Promise(res => setTimeout(res, 1000)); // Wait second as the client is momentarily updated after creation, resulting 404.
            await this.#createOrReplaceClientMiddleware(OIDCMiddlewareClient)
            await this.redisAdapter.upsert(OIDCMiddlewareClient.getClientId(), OIDCMiddlewareClient.toRedis())
            await this.#reportReady(OIDCMiddlewareClient, 'Reconciled', 'Traefik Middleware and Redis record are up to date')
        } catch (error) {
            await this.#reportFailure(OIDCMiddlewareClient, error)
        }
    }

    async #deleteOIDCClient (OIDCMiddlewareClient) {
        this.reconcileState.unregister(OIDCMiddlewareClient)
        if (OIDCMiddlewareClient.getInstance() === this.instance) {
            await this.redisAdapter.destroy(OIDCMiddlewareClient.getClientId())
        }
    }

    async #createOrReplaceClientMiddleware(OIDCMiddlewareClient) {
        const existingMiddleware = await this.adapter.getNamespacedCustomObject(
            TraefikMiddleware,
            OIDCMiddlewareClient.getClientNamespace(),
            OIDCMiddlewareClient.getClientName(),
            (r) => (r),
            TraefikMiddlewareApiGroup,
            TraefikMiddlewareApiGroupVersion
        )
        if (!existingMiddleware) {
            const middleware = await this.adapter.createNamespacedCustomObject(
                TraefikMiddleware,
                OIDCMiddlewareClient.getClientNamespace(),
                OIDCMiddlewareClient.getClientName(),
                {
                    spec: OIDCMiddlewareClient.toMiddlewareSpec(this.adapter.deployment, this.adapter.namespace),
                },
                (r) => (r),
                OIDCMiddlewareClient.getMetadata(),
                {},
                TraefikMiddlewareApiGroup,
                TraefikMiddlewareApiGroupVersion
            )
            if (!middleware) throw this.#reconcileError('MiddlewareReconcileFailed', 'Failed to create Traefik Middleware')
            return middleware
        } else {
            const middleware = await this.adapter.patchNamespacedCustomObject(
                TraefikMiddleware,
                OIDCMiddlewareClient.getClientNamespace(),
                OIDCMiddlewareClient.getClientName(),
                {spec: OIDCMiddlewareClient.toMiddlewareSpec(this.adapter.deployment, this.adapter.namespace)},
                {spec: existingMiddleware.spec},
                (r) => (r),
                TraefikMiddlewareApiGroup,
                TraefikMiddlewareApiGroupVersion
            )
            if (!middleware) throw this.#reconcileError('MiddlewareReconcileFailed', 'Failed to update Traefik Middleware')
            return middleware
        }
    }

    #reconcileError(reason, message) {
        return Object.assign(new Error(message), {reason})
    }

    async #reportReady(OIDCMiddlewareClient, reason, message) {
        const changed = OIDCMiddlewareClient.updateReadyCondition(true, reason, message)
        const updatedClient = await this.#replaceClientStatus(OIDCMiddlewareClient)
        if (changed && updatedClient) {
            await this.adapter.createEvent(
                OIDCMiddlewareClient.getClientNamespace(), OIDCMiddlewareClient.getMetadata(), reason, message, 'Normal'
            )
        }
    }

    async #reportFailure(OIDCMiddlewareClient, error) {
        const reason = error.reason ?? 'ReconcileFailed'
        const message = error.message ?? 'Middleware client reconciliation failed'
        const changed = OIDCMiddlewareClient.updateReadyCondition(false, reason, message)
        await this.#replaceClientStatus(OIDCMiddlewareClient)
        if (changed) {
            await this.adapter.createEvent(
                OIDCMiddlewareClient.getClientNamespace(), OIDCMiddlewareClient.getMetadata(), reason, message
            )
        }
        globalThis.logger.error({error, client: OIDCMiddlewareClient.getClientId()}, 'Failed to reconcile OIDCMiddlewareClient')
    }

    async #replaceClientStatus (OIDCMiddlewareClient) {
        OIDCMiddlewareClient = new Claimed().setStatus(true).set(OIDCMiddlewareClient)
        const status = {...OIDCMiddlewareClient.getIntendedStatus(), instance: this.instance}
        return await this.adapter.replaceNamespacedCustomObjectStatus(
            OIDCMiddlewareClientCrd,
            OIDCMiddlewareClient.getClientNamespace(),
            OIDCMiddlewareClient.getClientName(),
            OIDCMiddlewareClient.getResourceVersion(),
            status,
            (OIDCMiddlewareClient) => (new OidcMiddlewareClient()).fromIncomingClient(OIDCMiddlewareClient),
        )
    }
}
