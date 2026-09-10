import * as k8s from "@kubernetes/client-node";
import net from 'node:net';
import {
    defaultApiGroup,
    defaultApiGroupVersion,
    plurals
} from "../utils/kubernetes/kube-constants.js";
import {V1OwnerReference, V1Secret, setHeaderMiddleware, setHeaderOptions} from "@kubernetes/client-node";
import {diff} from 'jsondiffpatch';
import {format} from 'jsondiffpatch/formatters/jsonpatch';
import isEqual from 'lodash/isEqual.js';

// loadFromCluster() builds the API server URL straight from KUBERNETES_SERVICE_HOST,
// which on IPv6-only / dual-stack clusters is a bare IPv6 literal — so the client
// connects to https://[fd00::1]:443. The kube-apiserver serving cert always lists
// the DNS names (kubernetes.default.svc, ...) but not necessarily every ClusterIP as
// an IP SAN, so connecting by literal IP fails TLS verification with
// "Hostname/IP does not match certificate's altnames" on some clusters. The in-cluster
// DNS name kubernetes.default.svc is always present in the cert SANs, so we rewrite the
// server to use it and let the pod resolver pick the right address family.
//
// Gated by KUBERNETES_API_SERVICE_DNS: 'auto' (default) only rewrites when the host is
// an IPv6 literal (IPv4 clusters that work today are untouched); 'always' forces it;
// 'never' disables it. Returns the replacement server URL, or null to leave it as-is.
export const WATCH_TIMEOUT_MS = 60 * 60 * 1000

// A clean end or the client-node request timeout is routine — reconnect
// immediately so no CRD events are missed; back off only on genuine errors.
export const watchRestartDelayMs = (err) =>
    !err || err.name === 'TimeoutError' ? 0 : 10 * 1000

export function apiServerUrlViaServiceDns({
    host = process.env.KUBERNETES_SERVICE_HOST,
    port = process.env.KUBERNETES_SERVICE_PORT,
    mode = process.env.KUBERNETES_API_SERVICE_DNS ?? 'auto',
} = {}) {
    if (!host || mode === 'never') {
        return null
    }
    if (mode !== 'always' && !net.isIPv6(host)) {
        return null
    }
    const scheme = (port === '80' || port === '8080' || port === '8001') ? 'http' : 'https'
    return `${scheme}://kubernetes.default.svc:${port}`
}

export class KubernetesAdapter {
    constructor() {
        const kc = new k8s.KubeConfig();
        this.kc = kc
        // In-cluster by default; fall back to the local kubeconfig (KUBECONFIG or
        // ~/.kube/config) when not running inside a pod. This lets the operator run
        // against an out-of-cluster API server for local development and tests
        // (e.g. envtest), without changing in-cluster behaviour.
        if (process.env.KUBERNETES_SERVICE_HOST) {
            kc.loadFromCluster()
            // Must run before makeApiClient(), which captures cluster.server eagerly.
            const dnsServer = apiServerUrlViaServiceDns()
            if (dnsServer) {
                const cluster = kc.getCurrentCluster()
                if (cluster) {
                    globalThis.logger?.info(
                        { from: cluster.server, to: dnsServer },
                        'Kubernetes: using service DNS for the API server to avoid IPv6 TLS SAN mismatch'
                    )
                    cluster.server = dnsServer
                }
            }
        } else {
            kc.loadFromDefault()
        }
        this.namespace = kc.getContextObject(kc.getCurrentContext())?.namespace
            ?? process.env.POD_NAMESPACE
            ?? 'default';
        this.deployment = process.env.DEPLOYMENT_NAME
        this.instance = this.namespace + '-' + this.deployment
        const userAgentMiddleware = setHeaderMiddleware('User-Agent', this.instance)
        this.customObjectsApi = kc.makeApiClient(k8s.CustomObjectsApi);
        this.coreV1Api = kc.makeApiClient(k8s.CoreV1Api);
        this.batchV1Api = kc.makeApiClient(k8s.BatchV1Api);
        this.defaultOptions = { middleware: [userAgentMiddleware] }
    }

    async listNamespacedCustomObject(kind, namespace, mapperFunction, apiGroup = defaultApiGroup, apiGroupVersion = defaultApiGroupVersion) {
        return await this.customObjectsApi.listNamespacedCustomObject({
            group: apiGroup,
            version: apiGroupVersion,
            namespace,
            plural: plurals[kind]
        }, this.defaultOptions).then(async (r) => {
            return await Promise.all(
                r.items.map(async (s) => {
                    return mapperFunction(s)
                })
            )
        }).catch((e) => {
            if (e.code !== 404) {
                globalThis.logger.error(e)
                return null
            }
        })
    }

    async getNamespacedCustomObject(kind, namespace, id, mapperFunction, apiGroup = defaultApiGroup, apiGroupVersion = defaultApiGroupVersion) {
        return await this.customObjectsApi.getNamespacedCustomObject({
            group: apiGroup,
            version: apiGroupVersion,
            namespace,
            plural: plurals[kind],
            name: id
        }, this.defaultOptions).then((r) => {
            return mapperFunction(r)
        }).catch((e) => {
            if (e.code !== 404) {
                globalThis.logger.error(e)
                return null
            }
        })
    }

    async createNamespacedCustomObject(kind, namespace, name, spec, mapperFunction, owner, labels = {}, apiGroup = defaultApiGroup, apiGroupVersion = defaultApiGroupVersion) {
        return await this.customObjectsApi.createNamespacedCustomObject({
            group: apiGroup,
            version: apiGroupVersion,
            namespace,
            plural: plurals[kind],
            body: {
                apiVersion: apiGroup + '/' + apiGroupVersion,
                kind,
                metadata: {
                    name,
                    labels,
                    ownerReferences: owner ? [
                        this.#getOwnerReference(owner)
                    ] : undefined
                },
                ...spec
            }
        }, this.defaultOptions).then(async (r) => {
            return mapperFunction(r)
        }).catch((e) => {
            if (e.code !== 404) {
                globalThis.logger.error(e)
                return null
            }
        })
    }

    async deleteNamespacedCustomObject(kind, namespace, id, apiGroup = defaultApiGroup, apiGroupVersion = defaultApiGroupVersion) {
        return await this.customObjectsApi.deleteNamespacedCustomObject({
            group: apiGroup,
            version: apiGroupVersion,
            namespace,
            plural: plurals[kind],
            name: id
        }, this.defaultOptions).then(() => true).catch((e) => {
            if (e.code === 404) {
                return true // already gone; the caller wanted it absent
            }
            globalThis.logger.error(e)
            return false
        })
    }

    async patchNamespacedCustomObject(kind, namespace, id, values, existingValues, mapperFunction, apiGroup = defaultApiGroup, apiGroupVersion = defaultApiGroupVersion) {
        const delta = diff(existingValues, values)
        const patches = format(delta);
        const patchOptions = setHeaderOptions('Content-Type', 'application/json-patch+json', this.defaultOptions)
        return await this.customObjectsApi.patchNamespacedCustomObject({
            group: apiGroup,
            version: apiGroupVersion,
            namespace,
            plural: plurals[kind],
            name: id,
            body: patches
        }, patchOptions).then(async (r) => {
            return mapperFunction(r)
        }).catch((e) => {
            if (e.code !== 404) {
                globalThis.logger.error(e)
                return null
            }
        })
    }

    async replaceNamespacedCustomObjectStatus(kind, namespace, id, resourceVersion, status, mapperFunction, apiGroup = defaultApiGroup, apiGroupVersion = defaultApiGroupVersion) {
        return await this.customObjectsApi.replaceNamespacedCustomObjectStatus({
            group: apiGroup,
            version: apiGroupVersion,
            namespace,
            plural: plurals[kind],
            name: id,
            body: {
                apiVersion: apiGroup + '/' + apiGroupVersion,
                kind,
                metadata: {
                    name: id,
                    resourceVersion
                },
                status,
            }
        }, this.defaultOptions).then((r) => {
            return mapperFunction(r)
        }).catch((e) => {
            globalThis.logger.error(e)
        })
    }

    async mutateNamespacedCustomObjectStatus(kind, namespace, id, mapperFunction, statusFunction, apiGroup = defaultApiGroup, apiGroupVersion = defaultApiGroupVersion) {
        for (let attempt = 1; attempt <= 3; attempt++) {
            try {
                const current = await this.customObjectsApi.getNamespacedCustomObject({
                    group: apiGroup,
                    version: apiGroupVersion,
                    namespace,
                    plural: plurals[kind],
                    name: id,
                }, this.defaultOptions)
                const status = await statusFunction(mapperFunction(current))
                if (isEqual(current.status ?? {}, status ?? {})) {
                    return mapperFunction(current)
                }
                const updated = await this.customObjectsApi.replaceNamespacedCustomObjectStatus({
                    group: apiGroup,
                    version: apiGroupVersion,
                    namespace,
                    plural: plurals[kind],
                    name: id,
                    body: {
                        apiVersion: apiGroup + '/' + apiGroupVersion,
                        kind,
                        metadata: {
                            name: id,
                            resourceVersion: current.metadata.resourceVersion,
                        },
                        status,
                    },
                }, this.defaultOptions)
                return mapperFunction(updated)
            } catch (error) {
                if (error.code === 404) {
                    return null
                }
                if (error.code === 409 && attempt < 3) {
                    globalThis.logger?.warn(
                        {kind, namespace, id, attempt},
                        'Kubernetes status mutation conflicted, recomputing from the latest resource'
                    )
                    continue
                }
                globalThis.logger.error(error)
                return undefined
            }
        }
    }

    async getSecret(namespace, id) {
        return await this.coreV1Api.readNamespacedSecret({
            name: id,
            namespace
        }, this.defaultOptions).then(async (r) => {
            return {
                metadata: {
                    annotations: r.metadata?.annotations,
                    labels: r.metadata?.labels,
                },
                data: await this.#parseSecretData(r.data)
            }
        }).catch((e) => {
            if (e.code === 404) {
                return null
            } else {
                globalThis.logger.error(e)
            }
        })
    }

    // `ignoreAlreadyExists` reports a 409 as {alreadyExists: true} instead of a
    // failure, so a caller racing another writer can adopt the Secret that won
    // rather than treat the collision as an error (same contract as createJob).
    async createSecret(namespace, id, data, metadata, {ignoreAlreadyExists = false} = {}) {
        let kubeSecret = new V1Secret()
        kubeSecret.metadata = {
            name: id,
            ...metadata
        }
        kubeSecret.data = await this.#generateSecretData(data)
        return await this.coreV1Api.createNamespacedSecret({
            namespace,
            body: kubeSecret
        }, this.defaultOptions).then(async (r) => {
            return this.#parseSecretData(r.data)
        }).catch((e) => {
            const statusCode = e.code ?? e.statusCode ?? e.response?.statusCode
            if (ignoreAlreadyExists && statusCode === 409) {
                return {alreadyExists: true}
            }
            globalThis.logger.error(e)
            return null
        })
    }

    async patchSecret(namespace, id, data, metadata, existingSecret) {
        const delta = diff(
            {
                metadata: existingSecret.metadata,
                data: existingSecret.data,
            },
            {
                metadata: metadata,
                data: await this.#generateSecretData(data),
            })
        const patches = format(delta);
        const patchOptions = setHeaderOptions('Content-Type', 'application/json-patch+json', this.defaultOptions)
        return await this.coreV1Api.patchNamespacedSecret({
            name: id,
            namespace,
            body: patches
        }, patchOptions).then((r) => {
            return this.#parseSecretData(r.data)
        }).catch((e) => {
            globalThis.logger.error(e)
            return null
        })
    }

    async deleteSecret(namespace, id) {
        await this.coreV1Api.deleteNamespacedSecret({
            name: id,
            namespace
        }, this.defaultOptions).then(async (r) => {
            return r.status
        }).catch((e) => {
            if (e.code !== 404) {
                globalThis.logger.error(e)
                return null
            }
        })
    }

    async createJob(namespace, jobManifest, {ignoreAlreadyExists = false} = {}) {
        return await this.batchV1Api.createNamespacedJob({
            namespace,
            body: jobManifest
        }, this.defaultOptions).then((r) => {
            return r.status
        }).catch((e) => {
            const statusCode = e.code ?? e.statusCode ?? e.response?.statusCode
            if (ignoreAlreadyExists && statusCode === 409) {
                return {alreadyExists: true}
            }
            // Surface failures (not just 404) — a swallowed secret-refresh
            // failure was a source of "refresh not triggering" confusion (#69).
            globalThis.logger.error({ err: e, job: jobManifest?.metadata?.name }, 'Failed to create Kubernetes Job')
            return null
        })
    }

    async createEvent(namespace, involvedObject, reason, message, type = 'Warning') {
        const now = new Date()
        return await this.coreV1Api.createNamespacedEvent({
            namespace,
            body: {
                metadata: {
                    generateName: `${involvedObject.name}-`,
                    namespace,
                },
                involvedObject: {
                    apiVersion: involvedObject.apiVersion ?? `${defaultApiGroup}/${defaultApiGroupVersion}`,
                    kind: involvedObject.kind ?? 'OIDCUser',
                    name: involvedObject.name,
                    namespace,
                    uid: involvedObject.uid,
                },
                reason,
                message,
                type,
                source: {component: this.instance},
                firstTimestamp: now,
                lastTimestamp: now,
                count: 1,
            },
        }, this.defaultOptions).catch(error => {
            globalThis.logger.error({error, reason, involvedObject: involvedObject.name}, 'Failed to create Kubernetes Event')
            return null
        })
    }

    setWatchParameters (kind, mapperFunction, addedCallback, modifiedCallback, deletedCallback, namespaceFilter, apiGroup = defaultApiGroup, apiGroupVersion = defaultApiGroupVersion) {
        this.watchParameters = {
            kind,
            mapperFunction,
            addedCallback,
            modifiedCallback,
            deletedCallback,
            namespaceFilter,
            apiGroup,
            apiGroupVersion
        }
    }

    async watchObjects() {
        const kind = plurals[this.watchParameters.kind]
        globalThis.logger.info(`Watching Kubernetes API for ${kind}`)
        const watch = new k8s.Watch(this.kc);
        // @kubernetes/client-node 2.x aborts every watch request after
        // requestTimeoutMs (default 30s) by design and expects the caller to
        // re-watch. At the default, combined with the 10s error backoff below,
        // every operator was blind for a quarter of its lifetime and silently
        // missed CRD events. Keep the request alive for an hour (the apiserver
        // ends watches on its own terms well before that) and reconnect
        // immediately on expected termination.
        watch.requestTimeoutMs = WATCH_TIMEOUT_MS
        let path = this.watchParameters.namespaceFilter?.namespace ?
            `/apis/${this.watchParameters.apiGroup}/${this.watchParameters.apiGroupVersion}/namespaces/${this.watchParameters.namespaceFilter.namespace}` :
            `/apis/${this.watchParameters.apiGroup}/${this.watchParameters.apiGroupVersion}`
        path = path + '/' + kind
        watch.watch(
            path,
            {},
            async (type, apiObj, watchObj) => {
                if (watchObj?.status === 'Failure') {
                    throw new Error('Error watching Kubernetes API: ' + watchObj.message)
                }
                if (!this.watchParameters.namespaceFilter.filter(watchObj.object.metadata.namespace)) {
                    return
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
            // done callback is called when the watch terminates for any reason
            (err) => {
                const delay = watchRestartDelayMs(err)
                if (delay) {
                    globalThis.logger.warn('Kubernetes API watch terminated')
                    globalThis.logger.error(err)
                } else {
                    globalThis.logger.debug(`Kubernetes API watch for ${kind} expired, reconnecting`)
                }
                setTimeout(() => { this.watchObjects(); }, delay);
            }).then((abortController) => {
            // watch returns an AbortController which you can use to abort the watch.
            // setTimeout(() => { abortController.abort(); }, 10);
        });
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
            data[k] = val ? Buffer.from(val, 'utf-8').toString('base64') : val
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
