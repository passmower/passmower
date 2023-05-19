import * as k8s from "@kubernetes/client-node";
import {KubeOIDCUserService} from "./kube-oidc-user-service.js";
import WatchRequest from "../support/watch-request.js";
import {V1OwnerReference, V1Secret} from "@kubernetes/client-node";
import OidcClient from "../support/oidc-client.js";
import {
    OIDCGWClients,
    apiGroup,
    OIDCGWUser,
    apiGroupVersion, OIDCGWClientSecretClientIdKey, OIDCGWClient
} from "../support/kube-constants.js";
import RedisAdapter from "../adapters/redis.js";

export class KubeOIDCClientOperator extends KubeOIDCUserService {
    constructor(provider) {
        super();
        this.redisAdapter = new RedisAdapter('Client')
        this.provider = provider
    }

    async watchClients() {
        console.log('Watching Kubernetes API for OIDCGWClients')
        globalThis.OIDCClients = []
        const watch = new k8s.Watch(this.kc, new WatchRequest());
        watch.watch(
            `/apis/${apiGroup}/${apiGroupVersion}/namespaces/${this.namespace}/${OIDCGWClients}`,
            {},
            async (type, apiObj, watchObj) => {
                if (watchObj?.status === 'Failure') {
                    throw new Error('Error watching Kubernetes API: ' + watchObj.message)
                }
                const OIDCClient = new OidcClient()
                OIDCClient.fromIncomingClient(apiObj)
                if (type === 'ADDED') {
                    await this.#createOIDCClient(OIDCClient)
                } else if (type === 'MODIFIED') {
                    await this.#updateOIDCClient(OIDCClient)
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
                console.log('Kubernetes API watch terminated')
                if (err) {
                    console.error(err)
                }
                setTimeout(() => { this.watchClients(); }, 10 * 1000);
            }).then((req) => {
                // watch returns a request object which you can use to abort the watch.
                // setTimeout(() => { req.abort(); }, 10);
            });
    }

    async #createOIDCClient (OIDCClient) {
        if (OIDCClient.getGateway() === this.currentGateway) {
            if (!await this.redisAdapter.find(OIDCClient.getClientId())) {
                // Recreate the Kube secret if we don't have the client in Redis. It's an edge case anyways.
                OIDCClient.generateSecret()
                await this.#deleteKubeSecret(OIDCClient)
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

    async #updateOIDCClient(OIDCClient) {
        let secret = await this.#getKubeSecret(OIDCClient)
        secret ? OIDCClient.setSecret(secret[OIDCGWClientSecretClientIdKey]) : OIDCClient.generateSecret()
        await this.#patchKubeSecret(OIDCClient)
        await this.redisAdapter.upsert(OIDCClient.getClientId(), OIDCClient.toRedis())
    }

    async #replaceClientStatus (OIDCClient) {
        return await this.customObjectsApi.replaceNamespacedCustomObjectStatus(
            apiGroup,
            apiGroupVersion,
            OIDCClient.getClientNamespace(),
            OIDCGWClients,
            OIDCClient.getClientName(),
            {
                apiVersion: apiGroup + '/' + apiGroupVersion,
                kind: OIDCGWUser,
                metadata: {
                    name: OIDCClient.getClientName(),
                    resourceVersion: OIDCClient.getResourceVersion()
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

    async #getKubeSecret(OIDCClient) {
        return await this.coreV1Api.readNamespacedSecret(
            OIDCClient.getSecretName(),
            OIDCClient.getClientNamespace()
        ).then(async (r) => {
            return this.#parseSecretData(r.body.data)
        }).catch((e) => {
            if (e.statusCode === 404) {
                return null
            } else {
                console.error(e)
            }
        })
    }

    async #createKubeSecret(OIDCClient) {
        let kubeSecret = new V1Secret()
        kubeSecret.metadata = {
            name: OIDCClient.getSecretName(),
            ownerReferences: [
                this.#getSecretOwnerReference(OIDCClient)
            ]
        }
        kubeSecret.data = await this.#generateSecretData(OIDCClient)
        await this.coreV1Api.createNamespacedSecret(
            OIDCClient.getClientNamespace(),
            kubeSecret
        ).then(async (r) => {
            return this.#parseSecretData(r.body.data)
        }).catch((e) => {
            console.error(e)
            return null
        })
    }

    #getSecretOwnerReference(OIDCClient) {
        const ref = new V1OwnerReference()
        ref.uid = OIDCClient.getUid()
        ref.name = OIDCClient.getClientName()
        ref.kind = OIDCGWClient
        ref.apiVersion = `${apiGroup}/${apiGroupVersion}`
        ref.controller = true
        ref.blockOwnerDeletion = false
        return ref
    }

    async #deleteKubeSecret(OIDCClient) {
        await this.coreV1Api.deleteNamespacedSecret(
            OIDCClient.getSecretName(),
            OIDCClient.getClientNamespace()
        ).then(async (r) => {
            return r.body.status
        }).catch((e) => {
            if (e.statusCode !== 404) {
                console.error(e)
                return null
            }
        })
    }

    async #patchKubeSecret(OIDCClient) {
        const secret = await this.#generateSecretData(OIDCClient)
        let patches = Object.keys(secret).map((k) => {
            return {
                "op": "replace",
                "path": "/data/" + k,
                "value": secret[k]
            }
        })

        return await this.coreV1Api.patchNamespacedSecret(
            OIDCClient.getSecretName(),
            OIDCClient.getClientNamespace(),
            patches,
            undefined,
            undefined,
            undefined,
            undefined,
            undefined,
            { "headers": { "Content-type": k8s.PatchUtils.PATCH_FORMAT_JSON_PATCH}}
        ).then((r) => {
            return this.#parseSecretData(r.body.data)
        }).catch((e) => {
            console.error(e)
            return null
        })
    }

    async #deleteOIDCClient (OIDCClient) {
        if (OIDCClient.getGateway() === this.currentGateway) {
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
        const model = OIDCClient.toClientSecret(this.provider)
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

export default KubeOIDCClientOperator
