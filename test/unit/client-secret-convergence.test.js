import {beforeEach, describe, expect, it, vi} from 'vitest'
import {FakeKubernetesAdapter} from '../fakes/fake-kubernetes-adapter.js'
import {KubeOIDCClientOperator} from '../../src/operators/kube-oidc-client-operator.js'

class FakeRedisAdapter {
    records = new Map()

    async find(id) { return this.records.get(id) }
    async upsert(id, value) { this.records.set(id, value) }
    async destroy(id) { this.records.delete(id) }
}

const oidcClient = (name, {refreshJob = false} = {}) => ({
    metadata: {name, namespace: 'apps', generation: 1, uid: `uid-${name}`, resourceVersion: '1'},
    spec: {
        grantTypes: ['authorization_code'], responseTypes: ['code'],
        redirectUris: [`https://${name}.example.com/callback`], availableScopes: ['openid'],
        ...(refreshJob
            ? {secretRefreshJobSpec: {template: {spec: {containers: [{name: 'refresh', image: 'busybox'}]}}}}
            : {}),
    },
    status: {},
})

const secretOf = (adapter, name = 'grafana') =>
    adapter.secrets.get(`apps/oidc-client-${name}-owner-secrets`)?.data?.OIDC_CLIENT_SECRET

describe('client secret convergence under overlapping reconciles', () => {
    let adapter, redis, operator

    beforeEach(async () => {
        globalThis.logger = {debug() {}, info() {}, warn() {}, error() {}, trace() {}}
        adapter = new FakeKubernetesAdapter({namespace: 'apps', instance: 'test-passmower'})
        adapter.deployment = 'passmower'
        redis = new FakeRedisAdapter()
        operator = new KubeOIDCClientOperator(
            {urlFor: endpoint => `https://id.example.com/${endpoint}`}, adapter, redis)
        await operator.watchClients()
    })

    // The multi-replica case: every pod receives its own ADDED for the same
    // object, and the instance identity is per-Deployment so each pod believes
    // the client is its own to reconcile.
    it('issues exactly one secret when two reconciles race a new client', async () => {
        // Every client_secret that actually lands in the Secret. Both reconciles
        // *generate* one — the loser's is then refused by the 409, which is the
        // point — so what matters is how many distinct values get installed.
        // Counting only the end state would miss it: the loser's value can be
        // the one the application already read.
        const issued = new Set()
        const create = adapter.createSecret.bind(adapter)
        const patch = adapter.patchSecret.bind(adapter)
        adapter.createSecret = async (ns, id, data, ...rest) => {
            const result = await create(ns, id, data, ...rest)
            if (result && !result.alreadyExists) issued.add(data.OIDC_CLIENT_SECRET)
            return result
        }
        adapter.patchSecret = async (ns, id, data, ...rest) => {
            const result = await patch(ns, id, data, ...rest)
            if (result) issued.add(data.OIDC_CLIENT_SECRET)
            return result
        }
        adapter.seed('OIDCClient', oidcClient('grafana'))

        await Promise.all([
            adapter.fireWatch('ADDED', 'OIDCClient', 'grafana'),
            adapter.fireWatch('ADDED', 'OIDCClient', 'grafana'),
        ])

        expect([...issued]).toHaveLength(1)
        // And the value the application reads is the value the provider holds.
        expect(secretOf(adapter)).toBe([...issued][0])
        expect(redis.records.get('apps.grafana').client_secret).toBe(secretOf(adapter))
        expect(adapter.list('OIDCClient')[0].status.conditions).toContainEqual(
            expect.objectContaining({type: 'Ready', status: 'True', reason: 'Reconciled'}))
    })

    it('never deletes a client Secret while reconciling', async () => {
        const deleteSecret = vi.spyOn(adapter, 'deleteSecret')
        adapter.seed('OIDCClient', oidcClient('grafana'))

        await Promise.all([
            adapter.fireWatch('ADDED', 'OIDCClient', 'grafana'),
            adapter.fireWatch('ADDED', 'OIDCClient', 'grafana'),
        ])

        // Rotating a client_secret breaks the consuming app until its workload
        // restarts, so it must never be a side effect of reconciling.
        expect(deleteSecret).not.toHaveBeenCalled()
    })

    it('adopts an existing secret rather than issuing a new one', async () => {
        adapter.secrets.set('apps/oidc-client-grafana-owner-secrets', {
            data: {OIDC_CLIENT_SECRET: 'secret-from-a-previous-reconcile'},
            metadata: {},
        })
        adapter.seed('OIDCClient', oidcClient('grafana'))

        await adapter.fireWatch('ADDED', 'OIDCClient', 'grafana')

        expect(secretOf(adapter)).toBe('secret-from-a-previous-reconcile')
        expect(redis.records.get('apps.grafana').client_secret)
            .toBe('secret-from-a-previous-reconcile')
    })

    it('adopts the winner when the Secret appears between the read and the create', async () => {
        // The interleaving the 409 path exists for: nothing there when we look,
        // something there when we write.
        adapter.seed('OIDCClient', oidcClient('grafana'))
        const create = adapter.createSecret.bind(adapter)
        adapter.createSecret = async (namespace, id, data, metadata, options) => {
            adapter.secrets.set(`${namespace}/${id}`, {
                data: {OIDC_CLIENT_SECRET: 'secret-from-the-other-replica'}, metadata: {},
            })
            adapter.createSecret = create
            return await create(namespace, id, data, metadata, options)
        }

        await adapter.fireWatch('ADDED', 'OIDCClient', 'grafana')

        expect(secretOf(adapter)).toBe('secret-from-the-other-replica')
        expect(redis.records.get('apps.grafana').client_secret).toBe('secret-from-the-other-replica')
        expect(adapter.list('OIDCClient')[0].status.conditions).toContainEqual(
            expect.objectContaining({type: 'Ready', status: 'True'}))
    })

    it('fails loudly if the Secret exists but cannot be read back', async () => {
        adapter.seed('OIDCClient', oidcClient('grafana'))
        adapter.createSecret = async () => ({alreadyExists: true})
        adapter.getSecret = async () => undefined

        await adapter.fireWatch('ADDED', 'OIDCClient', 'grafana')

        // Previously this shape was "repaired" by deleting and reissuing, which
        // silently rotated the secret; an unreadable Secret is now surfaced.
        expect(adapter.list('OIDCClient')[0].status.conditions).toContainEqual(
            expect.objectContaining({type: 'Ready', status: 'False', reason: 'SecretReconcileFailed'}))
        expect(redis.records.size).toBe(0)
    })
})

describe('secret-refresh Job under overlapping reconciles', () => {
    let adapter, redis, operator

    beforeEach(async () => {
        globalThis.logger = {debug() {}, info() {}, warn() {}, error() {}, trace() {}}
        adapter = new FakeKubernetesAdapter({namespace: 'apps', instance: 'test-passmower'})
        adapter.deployment = 'passmower'
        redis = new FakeRedisAdapter()
        operator = new KubeOIDCClientOperator(
            {urlFor: endpoint => `https://id.example.com/${endpoint}`}, adapter, redis)
        await operator.watchClients()
    })

    it('treats an already-created Job as done, not as a failure', async () => {
        adapter.seed('OIDCClient', oidcClient('grafana', {refreshJob: true}))

        await Promise.all([
            adapter.fireWatch('ADDED', 'OIDCClient', 'grafana'),
            adapter.fireWatch('ADDED', 'OIDCClient', 'grafana'),
        ])

        // The name is derived from the resourceVersion, so the second create is
        // the same Job — one Job, and no spurious Warning on a healthy client.
        expect(adapter.jobs).toHaveLength(1)
        expect(adapter.list('OIDCClient')[0].status.conditions).toContainEqual(
            expect.objectContaining({type: 'Ready', status: 'True', reason: 'Reconciled'}))
        expect(adapter.events.filter(e => e.type === 'Warning')).toEqual([])
    })

    it('still reports a Job that genuinely could not be created', async () => {
        adapter.createJob = async () => null
        adapter.seed('OIDCClient', oidcClient('grafana', {refreshJob: true}))

        await adapter.fireWatch('ADDED', 'OIDCClient', 'grafana')

        expect(adapter.list('OIDCClient')[0].status.conditions).toContainEqual(
            expect.objectContaining({type: 'Ready', status: 'False', reason: 'RefreshJobReconcileFailed'}))
    })
})
