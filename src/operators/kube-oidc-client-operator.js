import OidcClient from "../models/oidc-client.js";
import {
    OIDCClientCrd,
    OIDCClientSecretClientSecretKey
} from "../utils/kubernetes/kube-constants.js";
import RedisAdapter from "../adapters/redis.js";
import {KubernetesAdapter} from "../adapters/kubernetes.js";
import {NamespaceFilter} from "../utils/kubernetes/namespace-filter.js";

export class KubeOIDCClientOperator {
    constructor(provider) {
        this.redisAdapter = new RedisAdapter('Client')
        this.provider = provider
        this.adapter = new KubernetesAdapter()
        this.instance = this.adapter.instance
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
        if (OIDCClient.hasSecret()) {
            await this.redisAdapter.upsert(OIDCClient.getClientId(), OIDCClient.toRedis())
        }
    }

    async #replaceClientStatus (OIDCClient) {
        const status = {
            instance: this.instance,
        }
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
        await new Promise(res => setTimeout(res, 1000));
        let secret = await this.adapter.getSecret(
            OIDCClient.getClientNamespace(),
            OIDCClient.getSecretName()
        )
        secret ? OIDCClient.setSecret(secret.data[OIDCClientSecretClientSecretKey]) : OIDCClient.generateSecret()
        await this.#patchKubeSecret(OIDCClient, secret)
        await this.redisAdapter.upsert(OIDCClient.getClientId(), OIDCClient.toRedis())
    }

    async #createKubeSecret(OIDCClient) {
        await this.adapter.createSecret(
            OIDCClient.getClientNamespace(),
            OIDCClient.getSecretName(),
            OIDCClient.toClientSecret(this.provider),
            OIDCClient.toClientSecretMetadata(),
        )
        if (OIDCClient.getSecretRefreshPod()) {
            await this.adapter.createPod(
                OIDCClient.getClientNamespace(),
                OIDCClient.getSecretRefreshPod()
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
        if (OIDCClient.getSecretRefreshPod()) {
            await this.adapter.createPod(
                OIDCClient.getClientNamespace(),
                OIDCClient.getSecretRefreshPod()
            )
        }
    }

    async #deleteOIDCClient (OIDCClient) {
        if (OIDCClient.getInstance() === this.instance) {
            await this.redisAdapter.destroy(OIDCClient.getClientId())
        }
    }
}

export default KubeOIDCClientOperator
