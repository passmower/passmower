import {beforeEach, describe, expect, it} from 'vitest'
import {FakeKubernetesAdapter} from '../fakes/fake-kubernetes-adapter.js'
import {KubeOIDCMiddlewareClientOperator} from '../../src/operators/kube-oidc-middleware-client-operator.js'
import {KubeOIDCClientOperator} from '../../src/operators/kube-oidc-client-operator.js'

class FakeRedisAdapter {
    records = new Map()

    async find(id) { return this.records.get(id) }
    async upsert(id, value) { this.records.set(id, value) }
    async destroy(id) { this.records.delete(id) }
}

function middlewareClient(name) {
    return {
        metadata: {
            name, namespace: 'apps', generation: 1, uid: `uid-${name}`,
        },
        spec: {
            uri: `https://${name}.example.com`,
            headerMapping: {user: 'Remote-User'},
        },
        status: {},
    }
}

function oidcClient(name) {
    return {
        metadata: {name, namespace: 'apps', generation: 1, uid: `uid-${name}`},
        spec: {
            grantTypes: ['authorization_code'], responseTypes: ['code'],
            redirectUris: [`https://${name}.example.com/callback`], availableScopes: ['openid'],
            secretRefreshJobSpec: {template: {spec: {containers: [{name: 'refresh', image: 'busybox'}]}}},
        },
        status: {},
    }
}

describe('OIDCMiddlewareClient reconciliation status', () => {
    let adapter, redis, operator

    beforeEach(async () => {
        globalThis.logger = {debug() {}, info() {}, warn() {}, error() {}, trace() {}}
        adapter = new FakeKubernetesAdapter({namespace: 'apps', instance: 'test-passmower'})
        adapter.deployment = 'passmower'
        redis = new FakeRedisAdapter()
        operator = new KubeOIDCMiddlewareClientOperator({}, adapter, redis)
        await operator.watchClients()
    })

    it('marks a reconciled client Ready and emits one Normal event', async () => {
        adapter.seed('OIDCMiddlewareClient', middlewareClient('grafana'))

        await adapter.fireWatch('ADDED', 'OIDCMiddlewareClient', 'grafana')

        expect(adapter.list('OIDCMiddlewareClient')[0].status.conditions).toContainEqual(expect.objectContaining({
            type: 'Ready', status: 'True', reason: 'Reconciled',
        }))
        expect(adapter.events).toEqual([expect.objectContaining({reason: 'Reconciled', type: 'Normal'})])
        expect(redis.records.size).toBe(1)

        await adapter.fireWatch('MODIFIED', 'OIDCMiddlewareClient', 'grafana')
        expect(adapter.events).toHaveLength(1)
    })

    it('marks a failed middleware creation Not Ready and emits a Warning event', async () => {
        adapter.createNamespacedCustomObject = async () => null
        adapter.seed('OIDCMiddlewareClient', middlewareClient('broken'))

        await adapter.fireWatch('ADDED', 'OIDCMiddlewareClient', 'broken')

        expect(adapter.list('OIDCMiddlewareClient')[0].status.conditions).toContainEqual(expect.objectContaining({
            type: 'Ready', status: 'False', reason: 'MiddlewareReconcileFailed',
        }))
        expect(adapter.events).toEqual([expect.objectContaining({
            reason: 'MiddlewareReconcileFailed', type: 'Warning',
        })])
        expect(redis.records.size).toBe(0)
    })
})

describe('OIDCClient reconciliation status', () => {
    it('reports a failed secret-refresh Job without writing an incomplete Redis record', async () => {
        globalThis.logger = {debug() {}, info() {}, warn() {}, error() {}, trace() {}}
        const adapter = new FakeKubernetesAdapter({namespace: 'apps', instance: 'test-passmower'})
        adapter.createJob = async () => null
        const redis = new FakeRedisAdapter()
        const provider = {urlFor: endpoint => `https://id.example.com/${endpoint}`}
        const operator = new KubeOIDCClientOperator(provider, adapter, redis)
        await operator.watchClients()
        adapter.seed('OIDCClient', oidcClient('broken-job'))

        await adapter.fireWatch('ADDED', 'OIDCClient', 'broken-job')

        expect(adapter.list('OIDCClient')[0].status.conditions).toContainEqual(expect.objectContaining({
            type: 'Ready', status: 'False', reason: 'RefreshJobReconcileFailed',
        }))
        expect(adapter.events).toEqual([expect.objectContaining({
            reason: 'RefreshJobReconcileFailed', type: 'Warning',
        })])
        expect(redis.records.size).toBe(0)
    })
})
