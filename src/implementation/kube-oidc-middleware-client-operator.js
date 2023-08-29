import RedisAdapter from "../adapters/redis.js";
import {KubernetesAdapter} from "../adapters/kubernetes.js";
import {
    OIDCGWMiddlewareClient, spec,
    TraefikMiddleware, TraefikMiddlewareApiGroup, TraefikMiddlewareApiGroupVersion,
} from "../support/kube-constants.js";
import OidcMiddlewareClient from "../support/oidc-middleware-client.js";
import {NamespaceFilter} from "../support/namespace-filter.js";
import {Ready} from "../support/conditions/ready.js";
import {Claimed} from "../support/conditions/claimed.js";

export class KubeOIDCMiddlewareClientOperator {
    constructor(provider) {
        this.redisAdapter = new RedisAdapter('Client')
        this.provider = provider
        this.adapter = new KubernetesAdapter()
        this.currentGateway = this.adapter.currentGateway
    }

    async watchClients() {
        this.adapter.setWatchParameters(
            OIDCGWMiddlewareClient,
            (OIDCMiddlewareClient) => (new OidcMiddlewareClient()).fromIncomingClient(OIDCMiddlewareClient),
            (OIDCMiddlewareClient) => this.#createOIDCClient(OIDCMiddlewareClient),
            (OIDCMiddlewareClient) => this.#updateOIDCClient(OIDCMiddlewareClient),
            (OIDCMiddlewareClient) => this.#deleteOIDCClient(OIDCMiddlewareClient),
            new NamespaceFilter(this.adapter.namespace)
        )
        await this.adapter.watchObjects()
    }

    async #createOIDCClient (OIDCMiddlewareClient) {
        if (OIDCMiddlewareClient.getGateway() === this.currentGateway) {
            if (!await this.redisAdapter.find(OIDCMiddlewareClient.getClientId())) {
                await this.#createOrReplaceClientMiddleware(OIDCMiddlewareClient)
                await this.redisAdapter.upsert(OIDCMiddlewareClient.getClientId(), OIDCMiddlewareClient.toRedis())
            }
        } else if (!OIDCMiddlewareClient.getGateway()) {
            // Claim that client
            const claimedClient = await this.#replaceClientStatus(OIDCMiddlewareClient)
            if (claimedClient?.getGateway() === this.currentGateway) {
                await this.#createOrReplaceClientMiddleware(OIDCMiddlewareClient)
                await this.redisAdapter.upsert(OIDCMiddlewareClient.getClientId(), OIDCMiddlewareClient.toRedis())
            }
        }
    }

    async #updateOIDCClient(OIDCMiddlewareClient) {
        await new Promise(res => setTimeout(res, 1000)); // Wait second as the client is momentarily updated after creation, resulting 404.
        await this.#createOrReplaceClientMiddleware(OIDCMiddlewareClient)
        await this.redisAdapter.upsert(OIDCMiddlewareClient.getClientId(), OIDCMiddlewareClient.toRedis())

    }

    async #deleteOIDCClient (OIDCMiddlewareClient) {
        if (OIDCMiddlewareClient.getGateway() === this.currentGateway) {
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
                OIDCMiddlewareClient.toMiddlewareSpec(this.adapter.deployment, this.adapter.namespace),
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
                await this.adapter.prefixValues(OIDCMiddlewareClient.toMiddlewareSpec(this.adapter.deployment, this.adapter.namespace), spec),
                await this.adapter.prefixValues(existingMiddleware.spec, spec),
                (r) => (r),
                TraefikMiddlewareApiGroup,
                TraefikMiddlewareApiGroupVersion
            )
        }
    }

    async #replaceClientStatus (OIDCMiddlewareClient) {
        OIDCMiddlewareClient = new Claimed().setStatus(true).set(OIDCMiddlewareClient)
        const status = {
            gateway: this.currentGateway,
            conditions: OIDCMiddlewareClient.getConditions(),
        }
        return await this.adapter.replaceNamespacedCustomObjectStatus(
            OIDCGWMiddlewareClient,
            OIDCMiddlewareClient.getClientNamespace(),
            OIDCMiddlewareClient.getClientName(),
            OIDCMiddlewareClient.getResourceVersion(),
            status,
            (OIDCMiddlewareClient) => (new OidcMiddlewareClient()).fromIncomingClient(OIDCMiddlewareClient),
        )
    }
}
