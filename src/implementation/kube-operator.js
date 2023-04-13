import * as k8s from "@kubernetes/client-node";
import {KubeApiService} from "./kube-api-service.js";
import WatchRequest from "../support/watch-request.js";
import {V1Secret} from "@kubernetes/client-node";
import OidcClient from "../support/oidc-client.js";
import {
    OIDCGWClients,
    apiGroup,
    OIDCGWUser,
    apiGroupVersion
} from "../support/kube-constants.js";
import RedisAdapter from "../adapters/redis.js";

export class KubeOperator extends KubeApiService {
    constructor() {
        super();
        this.redisAdapter = new RedisAdapter('Client')
    }

    async watchClients() {
        globalThis.OIDCClients = []
        const watch = new k8s.Watch(this.kc, new WatchRequest());
        watch.watch(
            `/apis/${apiGroup}/${apiGroupVersion}/${OIDCGWClients}`,
            {},
            async (type, apiObj, watchObj) => {
                const OIDCClient = new OidcClient()
                OIDCClient.fromIncomingClient(apiObj)
                if (type === 'ADDED') {
                    await this.#createOIDCClient(OIDCClient)
                } else if (type === 'DELETED') {
                    await this.#deleteOIDCClient(OIDCClient)
                } else {
                    // TODO: proper logging
                    // console.warn(watchObj)
                }
            },
            // done callback is called if the watch terminates normally
            (err) => {
                // tslint:disable-next-line:no-console
                console.log('terminated')
                console.log(err);
            }).then((req) => {
            // watch returns a request object which you can use to abort the watch.
            // setTimeout(() => { req.abort(); }, 10 * 1000);
            // TODO: handle stream closing due to CRD changing etc
        });
    }

    async #createOIDCClient (OIDCClient) {
        let clientReady = false
        if (OIDCClient.status.gateway === this.currentGateway) {
            if (! await this.redisAdapter.find(OIDCClient.getClientId())) {
                clientReady = true
            }
        } else if (!OIDCClient.status.gateway) {
            // Claim that client
            const claimedClient = await this.#replaceClientStatus(OIDCClient)
            if (claimedClient) {
                let kubeSecret = new V1Secret()
                kubeSecret.metadata = {
                    name: OIDCClient.getSecretName(),
                }
                kubeSecret.data = await this.#generateSecretData(OIDCClient)
                await this.coreV1Api.createNamespacedSecret(
                    OIDCClient.clientNamespace,
                    kubeSecret
                ).then(async (r) => {
                    return this.#parseSecretData(r.body.data)
                }).catch((e) => {
                    console.error(e)
                    return null
                })
                clientReady = true
            }
        }
        if (clientReady) {
            OIDCClient.generateSecret()
            await this.redisAdapter.upsert(OIDCClient.getClientId(), OIDCClient.toRedis(), 3600)
        }
    }

    async #replaceClientStatus (OIDCClient) {
        return await this.customObjectsApi.replaceNamespacedCustomObjectStatus(
            apiGroup,
            apiGroupVersion,
            OIDCClient.clientNamespace,
            OIDCGWClients,
            OIDCClient.clientName,
            {
                apiVersion: apiGroup + '/' + apiGroupVersion,
                kind: OIDCGWUser,
                metadata: {
                    name: OIDCClient.clientName,
                    resourceVersion: OIDCClient.resourceVersion
                },
                status: {
                    gateway: this.currentGateway
                }
            }
        ).then((r) => {
            return OIDCClient.fromIncomingClient(r.body)
        }).catch((e) => {
            if (e.statusCode === 404 || e.statusCode === 409) {
                return null
            } else {
                console.error(e)
            }
        })
    }

    async #deleteOIDCClient (OIDCClient) {
        if (OIDCClient.status.gateway === this.currentGateway) {
            await this.coreV1Api.deleteNamespacedSecret(
                OIDCClient.getSecretName(),
                OIDCClient.clientNamespace,
            ).catch((e) => {
                if (e.statusCode !== 404) {
                    console.error(e)
                    return null
                }
            })
            await this.redisAdapter.destroy(OIDCClient.getClientId())
        }
    }

    async #parseSecretData (secret) {
        let s = {}
        Object.keys(secret).forEach((k) => {
            const buff = Buffer.from(secret[k], 'base64');
            let val = buff.toString('utf-8');
            try {
                val = JSON.parse(val)
            } catch (e) {}
            s[k] = val
        })
        return s
    }

    async #generateSecretData (OIDCClient) {
        const model = OIDCClient.toClientSecret()
        const data = {}
        Object.keys(model).forEach((k) => {
            let val = model[k]
            if (Array.isArray(val)) {
                val = JSON.stringify(val)
            }
            const buff = Buffer.from(val, 'utf-8');
            data[k] = buff.toString('base64');
        })
        return data
    }
}

export default KubeOperator