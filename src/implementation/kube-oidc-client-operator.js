import OidcClient from "../support/oidc-client.js";
import {
    OIDCGWClient,
    OIDCGWClientSecretClientSecretKey
} from "../support/kube-constants.js";
import RedisAdapter from "../adapters/redis.js";
import {KubernetesAdapter} from "../adapters/kubernetes.js";
import {NamespaceFilter} from "../support/namespace-filter.js";
import util from "util";
import {Ready} from "../support/conditions/ready.js";
import {Claimed} from "../support/conditions/claimed.js";

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
            if (!await this.redisAdapter.find(OIDCClient.getClientId()) || !await this.adapter.getSecret(OIDCClient.getClientNamespace(), OIDCClient.getSecretName())) {
                // Recreate the Kube secret if we don't have the client in Redis. It's an edge case anyways.
                OIDCClient.generateSecret()
                await this.adapter.deleteSecret(
                    OIDCClient.getClientNamespace(),
                    OIDCClient.getSecretName()
                )
                await this.#createKubeSecret(OIDCClient)
                OIDCClient = new Ready().setStatus(false).set(OIDCClient) // Validate in updateOIDCClient
                await this.#replaceClientStatus(OIDCClient)
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
        OIDCClient = new Claimed().setStatus(true).set(OIDCClient)
        const status = {
            gateway: this.currentGateway,
            conditions: OIDCClient.getConditions(),
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
        await new Promise(res => setTimeout(res, 1000));
        let secret = await this.adapter.getSecret(
            OIDCClient.getClientNamespace(),
            OIDCClient.getSecretName()
        )
        if (secret) {
            OIDCClient = OIDCClient.setSecret(secret[OIDCGWClientSecretClientSecretKey])
            if (!util.isDeepStrictEqual(OIDCClient.toClientSecret(this.provider), secret) && new Ready().check(OIDCClient)) {
                OIDCClient = new Ready().setStatus(false).set(OIDCClient)
                await this.#replaceClientStatus(OIDCClient)
                return
            }
        } else {
            OIDCClient.generateSecret()
            OIDCClient = new Ready().setStatus(false).set(OIDCClient)
            OIDCClient = await this.#replaceClientStatus(OIDCClient)
        }
        if (!new Ready().check(OIDCClient)) {
            await this.redisAdapter.upsert(OIDCClient.getClientId(), OIDCClient.toRedis())
            let success = await this.#patchKubeSecret(OIDCClient)
            if (success) {
                OIDCClient = new Ready().setStatus(true).set(OIDCClient)
                await this.#replaceClientStatus(OIDCClient)
            }
        }
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
