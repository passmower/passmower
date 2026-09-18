import {beforeEach, describe, expect, it} from 'vitest'
import {FakeKubernetesAdapter} from '../fakes/fake-kubernetes-adapter.js'
import {KubeOIDCClientOperator} from '../../src/operators/kube-oidc-client-operator.js'
import {KubeOIDCMiddlewareClientOperator} from '../../src/operators/kube-oidc-middleware-client-operator.js'
import {OIDCClientCrd, OIDCMiddlewareClientCrd} from '../../src/utils/kubernetes/kube-constants.js'

class FakeRedisAdapter {
    records = new Map()
    failNextDestroy = false

    async find(id) { return this.records.get(id) }
    async upsert(id, value) { this.records.set(id, value) }
    async destroy(id) {
        if (this.failNextDestroy) {
            this.failNextDestroy = false
            // What ioredis throws with enableOfflineQueue off, which is the
            // state this adapter runs in once ready.
            throw new Error("Stream isn't writeable and enableOfflineQueue options is false")
        }
        this.records.delete(id)
    }
}

const oidcClient = (name) => ({
    metadata: {name, namespace: 'apps', generation: 1, uid: `uid-${name}`, resourceVersion: '1'},
    spec: {
        grantTypes: ['authorization_code'], responseTypes: ['code'],
        redirectUris: [`https://${name}.example.com/callback`], availableScopes: ['openid'],
    },
    status: {instance: 'apps-passmower'},
})

const middlewareClient = (name) => ({
    metadata: {name, namespace: 'apps', generation: 1, uid: `uid-${name}`, resourceVersion: '1'},
    spec: {uri: `https://${name}.example.com`, headerMapping: {}},
    status: {instance: 'apps-passmower'},
})

// A DELETED callback is the only thing that removes a client from Redis, and
// nothing ever redelivers it — so a Redis blip there used to surface as an
// unhandled rejection and lose the removal for good (#257). It has to stay
// contained, and it has to be logged, because the sweep is what repairs it.
describe('a Redis failure while handling a deleted client', () => {
    let adapter, redis, errors

    beforeEach(() => {
        errors = []
        globalThis.logger = {
            debug() {}, info() {}, warn() {}, trace() {},
            error(...args) { errors.push(args) },
        }
        adapter = new FakeKubernetesAdapter({namespace: 'apps', instance: 'apps-passmower'})
        adapter.deployment = 'passmower'
        redis = new FakeRedisAdapter()
    })

    it('does not escape the OIDCClient delete handler', async () => {
        const operator = new KubeOIDCClientOperator(
            {urlFor: endpoint => `https://id.example.com/${endpoint}`}, adapter, redis)
        await operator.watchClients()
        adapter.seed(OIDCClientCrd, oidcClient('grafana'))
        await redis.upsert('apps.grafana', {client_id: 'apps.grafana', kind: OIDCClientCrd})
        redis.failNextDestroy = true

        await expect(adapter.fireWatch('DELETED', OIDCClientCrd, 'grafana')).resolves.not.toThrow()
        expect(errors).toHaveLength(1)
        // Still there — which is exactly what the sweep exists to clean up.
        expect(await redis.find('apps.grafana')).toBeDefined()
    })

    it('does not escape the OIDCMiddlewareClient delete handler', async () => {
        const operator = new KubeOIDCMiddlewareClientOperator({}, adapter, redis)
        await operator.watchClients()
        adapter.seed(OIDCMiddlewareClientCrd, middlewareClient('wiki'))
        redis.failNextDestroy = true

        await expect(adapter.fireWatch('DELETED', OIDCMiddlewareClientCrd, 'wiki')).resolves.not.toThrow()
        expect(errors).toHaveLength(1)
    })

    it('still removes the record when Redis is healthy', async () => {
        const operator = new KubeOIDCClientOperator(
            {urlFor: endpoint => `https://id.example.com/${endpoint}`}, adapter, redis)
        await operator.watchClients()
        adapter.seed(OIDCClientCrd, oidcClient('grafana'))
        await redis.upsert('apps.grafana', {client_id: 'apps.grafana', kind: OIDCClientCrd})

        await adapter.fireWatch('DELETED', OIDCClientCrd, 'grafana')

        expect(await redis.find('apps.grafana')).toBeUndefined()
        expect(errors).toHaveLength(0)
    })
})
