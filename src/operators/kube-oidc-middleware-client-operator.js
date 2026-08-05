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

export class KubeOIDCMiddlewareClientOperator {
    constructor(provider, adapter = new KubernetesAdapter()) {
        this.redisAdapter = new RedisAdapter('Client')
        this.provider = provider
        this.adapter = adapter
        this.instance = this.adapter.instance
        this.activityTracker = getActivityTracker()
        this.reconciledGenerations = new Map()
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
        this.activityTracker.registerClient(OIDCMiddlewareClient)
        this.reconciledGenerations.set(OIDCMiddlewareClient.getClientId(), OIDCMiddlewareClient.getGeneration())
        if (OIDCMiddlewareClient.getInstance() === this.instance) {
            if (!await this.redisAdapter.find(OIDCMiddlewareClient.getClientId())) {
                await this.#createOrReplaceClientMiddleware(OIDCMiddlewareClient)
                if (!OIDCMiddlewareClient.isDisabled()) await this.redisAdapter.upsert(OIDCMiddlewareClient.getClientId(), OIDCMiddlewareClient.toRedis())
            }
        } else if (!OIDCMiddlewareClient.getInstance()) {
            // Claim that client
            const claimedClient = await this.#replaceClientStatus(OIDCMiddlewareClient)
            if (claimedClient?.getInstance() === this.instance) {
                await this.#createOrReplaceClientMiddleware(OIDCMiddlewareClient)
                if (!OIDCMiddlewareClient.isDisabled()) await this.redisAdapter.upsert(OIDCMiddlewareClient.getClientId(), OIDCMiddlewareClient.toRedis())
            }
        }
        if (OIDCMiddlewareClient.isDisabled()) await this.redisAdapter.destroy(OIDCMiddlewareClient.getClientId())
    }

    async #updateOIDCClient(OIDCMiddlewareClient) {
        this.activityTracker.registerClient(OIDCMiddlewareClient)
        const previousGeneration = this.reconciledGenerations.get(OIDCMiddlewareClient.getClientId())
        if (OIDCMiddlewareClient.getGeneration() !== null && previousGeneration === OIDCMiddlewareClient.getGeneration()) return
        this.reconciledGenerations.set(OIDCMiddlewareClient.getClientId(), OIDCMiddlewareClient.getGeneration())
        if (OIDCMiddlewareClient.isDisabled()) {
            await this.redisAdapter.destroy(OIDCMiddlewareClient.getClientId())
            return
        }
        await new Promise(res => setTimeout(res, 1000)); // Wait second as the client is momentarily updated after creation, resulting 404.
        await this.#createOrReplaceClientMiddleware(OIDCMiddlewareClient)
        await this.redisAdapter.upsert(OIDCMiddlewareClient.getClientId(), OIDCMiddlewareClient.toRedis())

    }

    async #deleteOIDCClient (OIDCMiddlewareClient) {
        this.activityTracker.unregisterClient(OIDCMiddlewareClient.getClientId())
        this.reconciledGenerations.delete(OIDCMiddlewareClient.getClientId())
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
            return await this.adapter.createNamespacedCustomObject(
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
        } else {
            return await this.adapter.patchNamespacedCustomObject(
                TraefikMiddleware,
                OIDCMiddlewareClient.getClientNamespace(),
                OIDCMiddlewareClient.getClientName(),
                {spec: OIDCMiddlewareClient.toMiddlewareSpec(this.adapter.deployment, this.adapter.namespace)},
                {spec: existingMiddleware.spec},
                (r) => (r),
                TraefikMiddlewareApiGroup,
                TraefikMiddlewareApiGroupVersion
            )
        }
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
