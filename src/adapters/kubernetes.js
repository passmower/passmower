import * as k8s from "@kubernetes/client-node";
import {
    defaultApiGroup,
    defaultApiGroupVersion,
    plulars
} from "../support/kube-constants.js";
import WatchRequest from "../support/watch-request.js";
import {V1OwnerReference, V1Secret} from "@kubernetes/client-node";

export class KubernetesAdapter {
    constructor() {
        const kc = new k8s.KubeConfig();
        this.kc = kc
        kc.loadFromCluster()
        this.customObjectsApi = kc.makeApiClient(k8s.CustomObjectsApi);
        this.coreV1Api = kc.makeApiClient(k8s.CoreV1Api);
        this.namespace = kc.getContextObject(kc.getCurrentContext()).namespace;
        this.deployment = process.env.DEPLOYMENT_NAME
        this.currentGateway = this.namespace + '-' + this.deployment
    }

    async listNamespacedCustomObject(kind, namespace, mapperFunction, apiGroup = defaultApiGroup, apiGroupVersion = defaultApiGroupVersion) {
        return await this.customObjectsApi.listNamespacedCustomObject(
            apiGroup,
            apiGroupVersion,
            namespace,
            plulars[kind]
        ).then(async (r) => {
            return await Promise.all(
                r.body.items.map(async (s) => {
                    return mapperFunction(s)
                })
            )
        }).catch((e) => {
            if (e.statusCode !== 404) {
                console.error(e)
                return null
            }
        })
    }

    async getNamespacedCustomObject(kind, namespace, id, mapperFunction, apiGroup = defaultApiGroup, apiGroupVersion = defaultApiGroupVersion) {
        return await this.customObjectsApi.getNamespacedCustomObject(
            apiGroup,
            apiGroupVersion,
            namespace,
            plulars[kind],
            id
        ).then((r) => {
            return mapperFunction(r.body)
        }).catch((e) => {
            if (e.statusCode !== 404) {
                console.error(e)
                return null
            }
        })
    }

    async createNamespacedCustomObject(kind, namespace, name, spec, mapperFunction, owner, apiGroup = defaultApiGroup, apiGroupVersion = defaultApiGroupVersion) {
        return await this.customObjectsApi.createNamespacedCustomObject(
            apiGroup,
            apiGroupVersion,
            namespace,
            plulars[kind],
            {
                apiVersion: apiGroup + '/' + apiGroupVersion,
                kind,
                metadata: {
                    name,
                    ownerReferences: owner ? [
                        this.#getOwnerReference(owner)
                    ] : undefined
                },
                spec
            }
        ).then(async (r) => {
            return mapperFunction(r.body)
        }).catch((e) => {
            if (e.statusCode !== 404) {
                console.error(e)
                return null
            }
        })
    }

    async patchNamespacedCustomObject(kind, namespace, id, spec, existingSpec, mapperFunction, apiGroup = defaultApiGroup, apiGroupVersion = defaultApiGroupVersion) {
        let patches = []
        for (let [key, value] of Object.entries(spec)) {
            patches = [...patches, ...this.#getPatches(key, value, existingSpec)]
        }
        return await this.customObjectsApi.patchNamespacedCustomObject(
            apiGroup,
            apiGroupVersion,
            namespace,
            plulars[kind],
            id,
            patches,
            undefined,
            undefined,
            undefined,
            { "headers": { "Content-type": k8s.PatchUtils.PATCH_FORMAT_JSON_PATCH}}
        ).then(async (r) => {
            return mapperFunction(r.body)
        }).catch((e) => {
            if (e.statusCode !== 404) {
                console.error(e)
                return null
            }
        })
    }

    async replaceNamespacedCustomObjectStatus(kind, namespace, id, resourceVersion, status, mapperFunction, apiGroup = defaultApiGroup, apiGroupVersion = defaultApiGroupVersion) {
        return await this.customObjectsApi.replaceNamespacedCustomObjectStatus(
            apiGroup,
            apiGroupVersion,
            namespace,
            plulars[kind],
            id,
            {
                apiVersion: apiGroup + '/' + apiGroupVersion,
                kind,
                metadata: {
                    name: id,
                    resourceVersion
                },
                status,
            }
        ).then((r) => {
            return mapperFunction(r.body)
        }).catch((e) => {
            console.error(e)
        })
    }

    async getSecret(namespace, id) {
        return await this.coreV1Api.readNamespacedSecret(
            id,
            namespace
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

    async createSecret(namespace, id, data, ownerMetadata) {
        let kubeSecret = new V1Secret()
        kubeSecret.metadata = {
            name: id,
            ownerReferences: [
                this.#getOwnerReference(ownerMetadata)
            ]
        }
        kubeSecret.data = await this.#generateSecretData(data)
        await this.coreV1Api.createNamespacedSecret(
            namespace,
            kubeSecret
        ).then(async (r) => {
            return this.#parseSecretData(r.body.data)
        }).catch((e) => {
            console.error(e)
            return null
        })
    }

    async patchSecret(namespace, id, data) {
        const secret = await this.#generateSecretData(data)
        let patches = Object.keys(secret).map((k) => {
            return {
                "op": "replace",
                "path": "/data/" + k,
                "value": secret[k]
            }
        })
        return await this.coreV1Api.patchNamespacedSecret(
            id,
            namespace,
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

    async deleteSecret(namespace, id) {
        await this.coreV1Api.deleteNamespacedSecret(
            id,
            namespace
        ).then(async (r) => {
            return r.body.status
        }).catch((e) => {
            if (e.statusCode !== 404) {
                console.error(e)
                return null
            }
        })
    }

    setWatchParameters (kind, mapperFunction, addedCallback, modifiedCallback, deletedCallback, namespace, apiGroup = defaultApiGroup, apiGroupVersion = defaultApiGroupVersion) {
        this.watchParameters = {
            kind,
            mapperFunction,
            addedCallback,
            modifiedCallback,
            deletedCallback,
            namespace,
            apiGroup,
            apiGroupVersion
        }
    }

    async watchObjects() {
        const kind = plulars[this.watchParameters.kind]
        globalThis.logger.info(`Watching Kubernetes API for ${kind}`)
        const watch = new k8s.Watch(this.kc, new WatchRequest());
        let path = this.watchParameters.namespace ?
            `/apis/${this.watchParameters.apiGroup}/${this.watchParameters.apiGroupVersion}/namespaces/${this.watchParameters.namespace}` :
            `/apis/${this.watchParameters.apiGroup}/${this.watchParameters.apiGroupVersion}`
        path = path + '/' + kind
        watch.watch(
            path,
            {},
            async (type, apiObj, watchObj) => {
                if (watchObj?.status === 'Failure') {
                    throw new Error('Error watching Kubernetes API: ' + watchObj.message)
                }
                const obj = this.watchParameters.mapperFunction(apiObj)
                if (type === 'ADDED') {
                    await this.watchParameters.addedCallback(obj)
                } else if (type === 'MODIFIED') {
                    await this.watchParameters.modifiedCallback(obj)
                } else if (type === 'DELETED') {
                    await this.watchParameters.deletedCallback(obj)
                } else {
                    // TODO: proper logging
                    // console.warn(watchObj)
                }
            },
            // done callback is called if the watch terminates normally
            (err) => {
                // tslint:disable-next-line:no-console
                globalThis.logger.warn('Kubernetes API watch terminated')
                if (err) {
                    console.error(err)
                }
                setTimeout(() => { this.watchObjects(); }, 10 * 1000);
            }).then((req) => {
            // watch returns a request object which you can use to abort the watch.
            // setTimeout(() => { req.abort(); }, 10);
        });
    }

    #getPatches (name, values, existingSpec) {
        let patches = []
        if (typeof values !== 'undefined') {
            const op = existingSpec?.[name] ? 'replace' : 'add'
            if (typeof values === 'object' && !Array.isArray(values)) {
                for (let [key, value] of Object.entries(values)) {
                    patches.push({
                        op,
                        "path": "/spec/" + name + '/' + key,
                        "value": value
                    })
                }
            } else {
                patches.push({
                    op,
                    "path":"/spec/" + name,
                    "value": values
                })
            }
        }
        return patches
    }

    #getOwnerReference(ownerMetadata) {
        const ref = new V1OwnerReference()
        Object.assign(ref, ownerMetadata)
        ref.controller = true
        ref.blockOwnerDeletion = false
        return ref
    }

    async #generateSecretData (model) {
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
}
