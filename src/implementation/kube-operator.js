import * as k8s from "@kubernetes/client-node";
import {KubeApiService} from "./kube-api-service.js";
import WatchRequest from "../support/watch-request.js";
import {V1Secret} from "@kubernetes/client-node";
import {randomUUID} from "crypto";
import {
    OIDCGWClients,
    apiGroup,
    OIDCGWUser,
    apiGroupVersion
} from "../support/kube-constants.js";

export class KubeOperator extends KubeApiService {
    async watchClients() {
        globalThis.OIDCClients = []
        const watch = new k8s.Watch(this.kc, new WatchRequest());
        watch.watch(
            `/apis/${apiGroup}/${apiGroupVersion}/${OIDCGWClients}`,
            {},
            async (type, apiObj, watchObj) => {
                if (type === 'ADDED') {
                    await this.#createOIDCClient(apiObj)
                } else if (type === 'MODIFIED') {
                    await this.#addOIDCClient(apiObj)
                } else if (type === 'DELETED') {
                    await this.#deleteOIDCClient(apiObj)
                } else {
                    // TODO: proper logging
                    // console.warn(watchObj)
                }
                console.debug(globalThis.OIDCClients)
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

    async #createOIDCClient (incomingClient) {
        let secret = null
        if (incomingClient.status && incomingClient.status.gateway) {
            if (incomingClient.status.gateway === this.currentGateway) {
                secret = await this.coreV1Api.
                readNamespacedSecret(this.#getSecretName(incomingClient), incomingClient.metadata.namespace).then((r) => {
                    return this.#parseSecretData(r.body.data)
                }).catch((e) => {
                    if (e.statusCode !== 404) {
                        console.error(e)
                        return null
                    }
                })
            }
        } else {
            // Claim that client
            const claimedClient = await this.#replaceClientStatus(incomingClient, false)
            if (claimedClient) {
                let kubeSecret = new V1Secret()
                kubeSecret.metadata = {
                    name: this.#getSecretName(incomingClient),
                }
                const keys = {
                    client_id: this.#getClientId(incomingClient),
                    client_secret: randomUUID(),
                    grant_types: [ 'implicit', 'refresh_token', 'authorization_code' ], // TODO: maybe let user choose
                    response_types: [ 'id_token' ],
                    redirect_uris: incomingClient.redirectUris,
                    gateway_uri: process.env.ISSUER_URL
                }
                kubeSecret.data = {}
                Object.keys(keys).forEach((k) => {
                    let val = keys[k]
                    if (Array.isArray(val)) {
                        val = JSON.stringify(val)
                    }
                    const buff = Buffer.from(val, 'utf-8');
                    kubeSecret.data[k] = buff.toString('base64');
                })
                secret = await this.coreV1Api.createNamespacedSecret(
                    incomingClient.metadata.namespace,
                    kubeSecret
                ).then(async (r) => {
                    await this.#replaceClientStatus(claimedClient, true)
                    return this.#parseSecretData(r.body.data)
                }).catch((e) => {
                    console.error(e)
                    return null
                })
            }
        }

        if (secret) {
            globalThis.OIDCClients[this.#getClientId(incomingClient)] = secret
        }
    }

    async #replaceClientStatus (incomingClient, hasSecret) {
        return await this.customObjectsApi.replaceNamespacedCustomObjectStatus(
            apiGroup,
            apiGroupVersion,
            incomingClient.metadata.namespace,
            OIDCGWClients,
            incomingClient.metadata.name,
            {
                apiVersion: apiGroup + '/' + apiGroupVersion,
                kind: OIDCGWUser,
                metadata: {
                    name: incomingClient.metadata.name,
                    resourceVersion: incomingClient.metadata.resourceVersion
                },
                status: {
                    gateway: this.currentGateway,
                    hasSecret: hasSecret
                }
            }
        ).then((r) => {
            return r.body
        }).catch((e) => {
            if (e.statusCode === 404 || e.statusCode === 409) {
                return null
            } else {
                console.error(e)
            }
        })
    }

    async #addOIDCClient (incomingClient) {
        if (incomingClient.status && incomingClient.status.gateway && incomingClient.status.hasSecret) {
            if (incomingClient.status.gateway === this.currentGateway) {
                if (globalThis.OIDCClients[this.#getClientId(incomingClient)] === undefined) {
                    globalThis.OIDCClients[this.#getClientId(incomingClient)] = await this.coreV1Api.readNamespacedSecret(
                        this.#getSecretName(incomingClient),
                        incomingClient.metadata.namespace,
                    ).then((r) => {
                        return this.#parseSecretData(r.body.data)
                    }).catch((e) => {
                        console.error(e)
                        return null
                    })
                }
            }
        }
    }

    async #deleteOIDCClient (incomingClient) {
        if (incomingClient.status && incomingClient.status.gateway) {
            if (incomingClient.status.gateway === this.currentGateway) {
                await this.coreV1Api.deleteNamespacedSecret(
                    this.#getSecretName(incomingClient),
                    incomingClient.metadata.namespace,
                ).catch((e) => {
                    if (e.statusCode !== 404) {
                        console.error(e)
                        return null
                    }
                })
                delete globalThis.OIDCClients[this.#getClientId(incomingClient)]
            }
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

    #getClientId (incomingClient) {
        return incomingClient.metadata.namespace + '-' + incomingClient.metadata.name // TODO: replaceable template in constants
    }

    #getSecretName (incomingClient) {
        return `oidc-client-${incomingClient.metadata.name}-owner-secrets` // TODO: replaceable template in constants
    }
}

export default KubeOperator