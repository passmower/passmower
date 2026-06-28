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
        this.secrets = new Map()     // `${namespace}/${name}` -> secret data
        this.watchHandlers = []      // for operator tests
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

    async createNamespacedCustomObject(kind, _namespace, name, spec, mapperFunction, _owner, labels = {}) {
        const key = this.#key(kind, name)
        if (this.store.has(key)) return null // name already taken -> real adapter swallows the conflict
        const obj = {
            apiVersion: 'codemowers.cloud/v1beta1',
            kind,
            metadata: { name, labels, resourceVersion: this.#nextRv() },
            status: {},
            ...structuredClone(spec),
        }
        this.store.set(key, obj)
        this.#emit('ADDED', kind, obj)
        return mapperFunction(structuredClone(obj))
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

    // --- Secrets (used by the client operator) ------------------------------

    async getSecret(namespace, id) { return this.secrets.get(`${namespace}/${id}`) }
    async createSecret(namespace, id, data) { this.secrets.set(`${namespace}/${id}`, data); return data }
    async replaceSecret(namespace, id, data) { this.secrets.set(`${namespace}/${id}`, data); return data }

    // --- Watch (used by operators) ------------------------------------------

    // Operators call setWatchParameters(...) then watchObjects(); for tests we
    // expose a hook to push synthetic events through whatever the operator
    // registered. Operators that don't use this can ignore it.
    onWatch(handler) { this.watchHandlers.push(handler) }
    #emit(type, kind, obj) {
        for (const h of this.watchHandlers) h(type, kind, structuredClone(obj))
    }

    // Test helpers -----------------------------------------------------------

    /** Seed a custom resource directly (bypassing create) for test fixtures. */
    seed(kind, obj) {
        const name = obj.metadata.name
        this.store.set(this.#key(kind, name), {
            apiVersion: 'codemowers.cloud/v1beta1',
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
}

export default FakeKubernetesAdapter
