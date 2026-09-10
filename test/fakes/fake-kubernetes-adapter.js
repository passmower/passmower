// In-memory stand-in for src/adapters/kubernetes.js used by unit/integration
// tests. It stores custom resources in a Map keyed by `${kind}/${name}` and
// reproduces the exact object shape the real adapter hands to mapper functions
// (top-level spec keys + metadata + status), so the real KubeOIDCUserService /
// models run unchanged on top of it.
//
// Inject it with:  vi.mock('../../src/adapters/kubernetes.js', () => ({ KubernetesAdapter: FakeKubernetesAdapter }))
// or by passing an instance into KubeOIDCUserService(adapter) / operators.

const SPEC_KEYS = ['spec', 'passmower', 'slack', 'github', 'identities', 'webauthn']

export class FakeKubernetesAdapter {
    constructor({ namespace = 'test', instance = 'test-passmower' } = {}) {
        this.namespace = namespace
        this.instance = instance
        this.store = new Map()       // `${kind}/${name}` -> stored CR object
        this.secrets = new Map()     // `${namespace}/${name}` -> { data, metadata }
        this.jobs = []               // jobs created via createJob (e.g. secret-refresh)
        this.events = []             // Kubernetes Events emitted by reconcilers
        this.watchHandlers = []      // for operator tests
        this.watchParameters = null  // set by setWatchParameters()
        this._rv = 0
    }

    #key(kind, name) { return `${kind}/${name}` }
    #nextRv() { return String(++this._rv) }

    // --- Custom objects -----------------------------------------------------

    async listNamespacedCustomObject(kind, _namespace, mapperFunction) {
        const items = [...this.store.entries()]
            .filter(([k]) => k.startsWith(`${kind}/`))
            .map(([, v]) => v)
        return Promise.all(items.map((v) => mapperFunction(structuredClone(v))))
    }

    async getNamespacedCustomObject(kind, _namespace, id, mapperFunction) {
        const stored = this.store.get(this.#key(kind, id))
        if (!stored) return undefined // real adapter returns undefined on 404
        return mapperFunction(structuredClone(stored))
    }

    async createNamespacedCustomObject(kind, _namespace, name, spec, mapperFunction, owner, labels = {}) {
        const key = this.#key(kind, name)
        if (this.store.has(key)) return null // name already taken -> real adapter swallows the conflict
        const obj = {
            apiVersion: 'codemowers.cloud/v1',
            kind,
            metadata: {
                name, labels,
                // The real adapter turns `owner` into an ownerReference, which is
                // what garbage-collects generated resources with their parent.
                ownerReferences: owner ? [structuredClone(owner)] : undefined,
                resourceVersion: this.#nextRv(),
                creationTimestamp: new Date().toISOString(),
            },
            status: {},
            ...structuredClone(spec),
        }
        this.store.set(key, obj)
        this.#emit('ADDED', kind, obj)
        return mapperFunction(structuredClone(obj))
    }

    async deleteNamespacedCustomObject(kind, _namespace, id) {
        const key = this.#key(kind, id)
        const existed = this.store.delete(key)
        if (existed) this.#emit('DELETED', kind, {kind, metadata: {name: id}})
        return true // absent either way, as the real adapter reports for a 404
    }

    async patchNamespacedCustomObject(kind, _namespace, id, values, _existingValues, mapperFunction) {
        const stored = this.store.get(this.#key(kind, id))
        if (!stored) return null
        for (const [k, v] of Object.entries(values)) {
            if (k === '/metadata') {
                stored.metadata = { ...stored.metadata, ...structuredClone(v) }
            } else if (SPEC_KEYS.includes(k)) {
                stored[k] = structuredClone(v)
            }
        }
        stored.metadata.resourceVersion = this.#nextRv()
        this.#emit('MODIFIED', kind, stored)
        return mapperFunction(structuredClone(stored))
    }

    async replaceNamespacedCustomObjectStatus(kind, _namespace, id, _resourceVersion, status, mapperFunction) {
        const stored = this.store.get(this.#key(kind, id))
        if (!stored) return undefined
        stored.status = structuredClone(status)
        stored.metadata.resourceVersion = this.#nextRv()
        this.#emit('MODIFIED', kind, stored)
        return mapperFunction(structuredClone(stored))
    }

    async mutateNamespacedCustomObjectStatus(kind, _namespace, id, mapperFunction, statusFunction) {
        const stored = this.store.get(this.#key(kind, id))
        if (!stored) return null
        const status = await statusFunction(mapperFunction(structuredClone(stored)))
        if (JSON.stringify(stored.status ?? {}) === JSON.stringify(status ?? {})) {
            return mapperFunction(structuredClone(stored))
        }
        stored.status = structuredClone(status)
        stored.metadata.resourceVersion = this.#nextRv()
        this.#emit('MODIFIED', kind, stored)
        return mapperFunction(structuredClone(stored))
    }

    // --- Secrets + pods (used by the client operator) -----------------------

    async getSecret(namespace, id) { return this.secrets.get(`${namespace}/${id}`) }
    // Creating over an existing Secret is a 409 in a real cluster; model that,
    // or a test cannot see two reconciles racing on the same client.
    async createSecret(namespace, id, data, metadata, {ignoreAlreadyExists = false} = {}) {
        const key = `${namespace}/${id}`
        if (this.secrets.has(key)) return ignoreAlreadyExists ? {alreadyExists: true} : null
        const s = { data: structuredClone(data), metadata }
        this.secrets.set(key, s)
        return s
    }
    async patchSecret(namespace, id, data, metadata) { const s = { data: structuredClone(data), metadata }; this.secrets.set(`${namespace}/${id}`, s); return s }
    async deleteSecret(namespace, id) { this.secrets.delete(`${namespace}/${id}`) }
    async createJob(namespace, jobManifest, {ignoreAlreadyExists = false} = {}) {
        const existing = this.jobs.find(job => job.namespace === namespace
            && job.jobManifest.metadata.name === jobManifest.metadata.name)
        if (existing) return ignoreAlreadyExists ? {alreadyExists: true} : null
        this.jobs.push({ namespace, jobManifest: structuredClone(jobManifest) })
        return { active: 1 }
    }
    async createEvent(namespace, involvedObject, reason, message, type = 'Warning') {
        const event = {namespace, involvedObject: structuredClone(involvedObject), reason, message, type}
        this.events.push(event)
        return event
    }

    // --- Watch (used by operators) ------------------------------------------

    setWatchParameters(kind, mapperFunction, addedCallback, modifiedCallback, deletedCallback) {
        this.watchParameters = { kind, mapperFunction, addedCallback, modifiedCallback, deletedCallback }
    }

    // Real adapter opens a long-lived watch here; tests drive events explicitly
    // via fireWatch() instead.
    async watchObjects() { /* no-op for tests */ }

    /**
     * Drive a synthetic watch event for a seeded resource, mirroring what the
     * real watch stream would deliver. Returns the reconcile callback's result.
     */
    async fireWatch(type, kind, name) {
        const stored = this.store.get(this.#key(kind, name))
        if (!stored) throw new Error(`fireWatch: ${kind}/${name} not seeded`)
        const mapped = this.watchParameters.mapperFunction(structuredClone(stored))
        const cb = {
            ADDED: this.watchParameters.addedCallback,
            MODIFIED: this.watchParameters.modifiedCallback,
            DELETED: this.watchParameters.deletedCallback,
        }[type]
        return cb(mapped)
    }

    onWatch(handler) { this.watchHandlers.push(handler) }
    #emit(type, kind, obj) {
        for (const h of this.watchHandlers) h(type, kind, structuredClone(obj))
    }

    // Test helpers -----------------------------------------------------------

    /** Seed a custom resource directly (bypassing create) for test fixtures. */
    seed(kind, obj) {
        const name = obj.metadata.name
        this.store.set(this.#key(kind, name), {
            apiVersion: 'codemowers.cloud/v1',
            kind,
            status: {},
            ...structuredClone(obj),
            metadata: { resourceVersion: this.#nextRv(), labels: {}, ...obj.metadata },
        })
    }

    /** All stored resources of a kind, as raw objects. */
    list(kind) {
        return [...this.store.entries()].filter(([k]) => k.startsWith(`${kind}/`)).map(([, v]) => v)
    }

    delete(kind, name) {
        this.store.delete(this.#key(kind, name))
    }
}

export default FakeKubernetesAdapter
