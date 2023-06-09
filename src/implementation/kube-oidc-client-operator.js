import OidcClient from "../support/oidc-client.js";
import {OIDCGWClientSecretClientIdKey, OIDCGWClient} from "../support/kube-constants.js";
import RedisAdapter from "../adapters/redis.js";
import {KubernetesAdapter} from "../adapters/kubernetes.js";
import {NamespaceFilter} from "../support/namespace-filter.js";

export class KubeOIDCClientOperator {
    constructor(provider) {
        this.redisAdapter = new RedisAdapter('Client')
        this.provider = provider
        this.adapter = new KubernetesAdapter()
        this.currentGateway = this.adapter.currentGateway
    }

    async watchClients() {
        this.adapter.setWatchParameters(
            OIDCGWClient,
            (OIDCClient) => (new OidcClient()).fromIncomingClient(OIDCClient),
            (OIDCClient) => this.#createOIDCClient(OIDCClient),
            (OIDCClient) => this.#updateOIDCClient(OIDCClient),
            (OIDCClient) => this.#deleteOIDCClient(OIDCClient),
            new NamespaceFilter(this.adapter.namespace)
        )
        await this.adapter.watchObjects()
    }

    async #createOIDCClient (OIDCClient) {
        if (OIDCClient.getGateway() === this.currentGateway) {
            if (!await this.redisAdapter.find(OIDCClient.getClientId())) {
                // Recreate the Kube secret if we don't have the client in Redis. It's an edge case anyways.
                OIDCClient.generateSecret()
                await this.adapter.deleteSecret(
                    OIDCClient.getClientNamespace(),
                    OIDCClient.getSecretName()
                )
                await this.#createKubeSecret(OIDCClient)
            }
        } else if (!OIDCClient.getGateway()) {
            // Claim that client
            const claimedClient = await this.#replaceClientStatus(OIDCClient)
            if (claimedClient?.getGateway() === this.currentGateway) {
                OIDCClient.generateSecret()
                await this.#createKubeSecret(OIDCClient)
            }
        }
        if (OIDCClient.hasSecret()) {
            await this.redisAdapter.upsert(OIDCClient.getClientId(), OIDCClient.toRedis())
        }
    }

    async #replaceClientStatus (OIDCClient) {
        const status = {
            gateway: this.currentGateway
        }
        return await this.adapter.replaceNamespacedCustomObjectStatus(
            OIDCGWClient,
            OIDCClient.getClientNamespace(),
            OIDCClient.getClientName(),
            OIDCClient.getResourceVersion(),
            status,
            (OIDCClient) => (new OidcClient()).fromIncomingClient(OIDCClient),
        )
    }

    async #updateOIDCClient(OIDCClient) {
        let secret = await this.adapter.getSecret(
            OIDCClient.getClientNamespace(),
            OIDCClient.getSecretName()
        )
        secret ? OIDCClient.setSecret(secret[OIDCGWClientSecretClientIdKey]) : OIDCClient.generateSecret()
        await this.#patchKubeSecret(OIDCClient)
        await this.redisAdapter.upsert(OIDCClient.getClientId(), OIDCClient.toRedis())
    }

    async #createKubeSecret(OIDCClient) {
        return await this.adapter.createSecret(
            OIDCClient.getClientNamespace(),
            OIDCClient.getSecretName(),
            OIDCClient.toClientSecret(this.provider),
            OIDCClient.getMetadata()
        )
    }

    async #patchKubeSecret(OIDCClient) {
        return await this.adapter.patchSecret(
            OIDCClient.getClientNamespace(),
            OIDCClient.getSecretName(),
            OIDCClient.toClientSecret(this.provider),
        )
    }

    async #deleteOIDCClient (OIDCClient) {
        if (OIDCClient.getGateway() === this.currentGateway) {
            await this.redisAdapter.destroy(OIDCClient.getClientId())
        }
    }
}

export default KubeOIDCClientOperator
