import {beforeEach, afterEach, describe, expect, it} from 'vitest'
import {FakeKubernetesAdapter} from '../fakes/fake-kubernetes-adapter.js'
import {ClientRedisReconciler, getReconcileIntervalMs} from '../../src/services/client-redis-reconciler.js'
import {OIDCClientCrd, OIDCMiddlewareClientCrd} from '../../src/utils/kubernetes/kube-constants.js'

// Stands in for both RedisAdapter('Client') and RedisAdapter('Clients'): the
// reconciler reads the set through one and the records through the other, and
// the real destroy() drops the id from the set as a side effect.
class FakeRedisAdapter {
    constructor(records = new Map()) {
        this.records = records
        this.members = new Set()
    }

    async find(id) { return this.records.get(id) }
    async upsert(id, value) { this.records.set(id, value); this.members.add(id) }
    async destroy(id) { this.records.delete(id); this.members.delete(id) }
    async getSetMembers() { return [...this.members] }
}

const oidcClient = (name, namespace = 'apps') => ({
    metadata: {name, namespace, generation: 1, uid: `uid-${name}`, resourceVersion: '1'},
    spec: {
        grantTypes: ['authorization_code'], responseTypes: ['code'],
        redirectUris: [`https://${name}.example.com/callback`], availableScopes: ['openid'],
        uri: `https://${name}.example.com`,
    },
    status: {},
})

const middlewareClient = (name, namespace = 'apps') => ({
    metadata: {name, namespace, generation: 1, uid: `uid-${name}`, resourceVersion: '1'},
    spec: {uri: `https://${name}.example.com`, headerMapping: {}},
    status: {},
})

// What the operators actually put in Redis for each kind.
const clientRecord = (name, namespace = 'apps') => ({
    client_id: `${namespace}.${name}`, client_name: name, clientNamespace: namespace,
    uri: `https://${name}.example.com`, kind: OIDCClientCrd,
})
const middlewareRecord = (name, namespace = 'apps') => ({
    client_id: `middleware-${namespace}.${name}`, client_name: name, clientNamespace: namespace,
    uri: `https://${name}.example.com`, kind: OIDCMiddlewareClientCrd,
})

describe('client Redis reconcile sweep', () => {
    let adapter, redis, reconciler

    beforeEach(() => {
        globalThis.logger = {debug() {}, info() {}, warn() {}, error() {}, trace() {}}
        delete process.env.NAMESPACE_SELECTOR
        adapter = new FakeKubernetesAdapter({namespace: 'apps', instance: 'apps-passmower'})
        redis = new FakeRedisAdapter()
        reconciler = new ClientRedisReconciler(adapter, redis)
        reconciler.clientsRedis = redis
    })

    afterEach(() => {
        reconciler.stop()
        delete process.env.NAMESPACE_SELECTOR
    })

    // The bug in #257: the CR is gone but the DELETED that would have removed
    // the record never landed, so the app keeps rendering in the launcher.
    it('removes a record whose custom resource is gone', async () => {
        await redis.upsert('apps.grafana', clientRecord('grafana'))

        expect(await reconciler.sweep()).toEqual(['apps.grafana'])
        expect(await redis.find('apps.grafana')).toBeUndefined()
        expect(await redis.getSetMembers(1)).toEqual([])
    })

    it('keeps a record whose custom resource still exists', async () => {
        adapter.seed(OIDCClientCrd, oidcClient('grafana'))
        await redis.upsert('apps.grafana', clientRecord('grafana'))

        expect(await reconciler.sweep()).toEqual([])
        expect(await redis.find('apps.grafana')).toBeDefined()
    })

    // Both kinds share the 'Client' model and the 'Clients' set, so a sweep that
    // listed only OIDCClients would find every middleware record unaccounted for.
    it('does not delete middleware clients while sweeping OIDC clients', async () => {
        adapter.seed(OIDCMiddlewareClientCrd, middlewareClient('wiki'))
        await redis.upsert('middleware-apps.wiki', middlewareRecord('wiki'))
        await redis.upsert('apps.grafana', clientRecord('grafana'))

        expect(await reconciler.sweep()).toEqual(['apps.grafana'])
        expect(await redis.find('middleware-apps.wiki')).toBeDefined()
    })

    it('removes a middleware record whose custom resource is gone', async () => {
        await redis.upsert('middleware-apps.wiki', middlewareRecord('wiki'))

        expect(await reconciler.sweep()).toEqual(['middleware-apps.wiki'])
    })

    // A failed LIST looks exactly like an empty cluster once it is a Set of ids.
    // Acting on it would empty Redis of every client there is.
    it('sweeps nothing when listing resources fails', async () => {
        adapter.seed(OIDCClientCrd, oidcClient('grafana'))
        await redis.upsert('apps.grafana', clientRecord('grafana'))
        adapter.listNamespacedCustomObject = async () => null

        expect(await reconciler.sweep()).toEqual([])
        expect(await redis.find('apps.grafana')).toBeDefined()
    })

    // The list is a snapshot. A client created just after it was taken is not in
    // it, and deleting its record would leave it broken until the next watch
    // reconnect — up to an hour later.
    it('re-checks the resource before deleting, so a just-created client survives', async () => {
        await redis.upsert('apps.grafana', clientRecord('grafana'))
        // Absent from the list, present by the time the sweep confirms.
        adapter.listNamespacedCustomObject = async () => []
        adapter.seed(OIDCClientCrd, oidcClient('grafana'))

        expect(await reconciler.sweep()).toEqual([])
        expect(await redis.find('apps.grafana')).toBeDefined()
    })

    // A failed GET is not evidence of absence; only a 404 is.
    it('keeps the record when the confirming read fails', async () => {
        await redis.upsert('apps.grafana', clientRecord('grafana'))
        adapter.getNamespacedCustomObject = async () => null

        expect(await reconciler.sweep()).toEqual([])
        expect(await redis.find('apps.grafana')).toBeDefined()
    })

    it('drops a set member whose record is already gone', async () => {
        redis.members.add('apps.stale')

        expect(await reconciler.sweep()).toEqual(['apps.stale'])
        expect(await redis.getSetMembers(1)).toEqual([])
    })

    it('leaves records of other kinds sharing the set alone', async () => {
        await redis.upsert('apps.other', {client_id: 'apps.other', kind: 'SomeOtherKind'})

        expect(await reconciler.sweep()).toEqual([])
        expect(await redis.find('apps.other')).toBeDefined()
    })

    // With a wildcard selector the sweep lists cluster-wide, and a record from a
    // namespace outside the selector is not this instance's to judge.
    it('ignores records outside the namespace selector', async () => {
        process.env.NAMESPACE_SELECTOR = 'apps-*'
        reconciler = new ClientRedisReconciler(adapter, redis)
        reconciler.clientsRedis = redis
        await redis.upsert('other.grafana', clientRecord('grafana', 'other'))

        expect(await reconciler.sweep()).toEqual([])
        expect(await redis.find('other.grafana')).toBeDefined()
    })

    it('sweeps cluster-wide when the selector is a wildcard', async () => {
        process.env.NAMESPACE_SELECTOR = 'apps-*'
        reconciler = new ClientRedisReconciler(adapter, redis)
        reconciler.clientsRedis = redis
        adapter.seed(OIDCClientCrd, oidcClient('grafana', 'apps-prod'))
        await redis.upsert('apps-prod.grafana', clientRecord('grafana', 'apps-prod'))
        await redis.upsert('apps-dev.wiki', clientRecord('wiki', 'apps-dev'))

        expect(await reconciler.sweep()).toEqual(['apps-dev.wiki'])
        expect(await redis.find('apps-prod.grafana')).toBeDefined()
    })

    // Every replica runs its own sweep (#236), and each sweep is several awaits
    // long, so one must not start while another is mid-flight.
    it('does not run two sweeps concurrently', async () => {
        await redis.upsert('apps.grafana', clientRecord('grafana'))
        let listed = 0
        adapter.listNamespacedCustomObject = async () => { listed++; return [] }

        const [first, second] = await Promise.all([reconciler.sweep(), reconciler.sweep()])

        expect(listed).toBe(2) // one sweep, two kinds
        expect([first, second].flat()).toEqual(['apps.grafana'])
    })
})

describe('reconcile interval configuration', () => {
    afterEach(() => { delete process.env.RECONCILE_INTERVAL_MS })

    it('defaults when unset or empty', () => {
        expect(getReconcileIntervalMs({})).toBe(300000)
        expect(getReconcileIntervalMs({RECONCILE_INTERVAL_MS: ''})).toBe(300000)
    })

    it('accepts an explicit interval and 0 to disable', () => {
        expect(getReconcileIntervalMs({RECONCILE_INTERVAL_MS: '60000'})).toBe(60000)
        expect(getReconcileIntervalMs({RECONCILE_INTERVAL_MS: '0'})).toBe(0)
    })

    it('rejects a non-integer or negative interval', () => {
        expect(() => getReconcileIntervalMs({RECONCILE_INTERVAL_MS: 'soon'})).toThrow()
        expect(() => getReconcileIntervalMs({RECONCILE_INTERVAL_MS: '-1'})).toThrow()
    })

    it('does not schedule anything when disabled', () => {
        globalThis.logger = {debug() {}, info() {}, warn() {}, error() {}, trace() {}}
        const reconciler = new ClientRedisReconciler(
            new FakeKubernetesAdapter(), new FakeRedisAdapter(), {intervalMs: 0})
        reconciler.start()
        expect(reconciler.timer).toBeUndefined()
    })
})
