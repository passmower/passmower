import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { FakeKubernetesAdapter } from '../fakes/fake-kubernetes-adapter.js'
import { KubeOIDCClientOperator } from '../../src/operators/kube-oidc-client-operator.js'
import OidcClient from '../../src/models/oidc-client.js'
import RedisAdapter from '../../src/adapters/redis.js'

// Reconciliation coverage for the OIDCClient operator (previously untested):
// claim -> secret -> Redis, updates, the secretRefreshJob hook (#69/#70) and delete.
describe('KubeOIDCClientOperator reconciliation', () => {
    let provider, adapter, operator
    const clientRedis = () => new RedisAdapter('Client')

    function rawClient(name, { secretRefreshJobSpec } = {}) {
        return {
            metadata: { name, namespace: 'apps', resourceVersion: '1', uid: `uid-${name}`, annotations: {} },
            spec: {
                grantTypes: ['authorization_code'],
                responseTypes: ['code'],
                redirectUris: ['https://app.example.com/cb'],
                availableScopes: ['openid'],
                tokenEndpointAuthMethod: 'client_secret_basic',
                ...(secretRefreshJobSpec ? { secretRefreshJobSpec } : {}),
            },
            status: {}, // unclaimed
        }
    }
    const refreshJobSpec = { template: { spec: { containers: [{ name: 'refresh', image: 'busybox' }] } } }
    const idOf = (name) => new OidcClient().fromIncomingClient(rawClient(name)).getClientId()

    beforeAll(async () => {
        process.env.REDIS_URI ??= 'redis://127.0.0.1:6379'
        globalThis.logger = { debug() {}, info() {}, warn() {}, error() {}, trace() {} }
        const { buildProvider } = await import('../../src/app.js')
        provider = await buildProvider()
    })

    afterAll(async () => {
        const { disconnect } = await import('../../src/adapters/redis.js')
        await disconnect()
    })

    beforeEach(async () => {
        adapter = new FakeKubernetesAdapter({ namespace: 'apps', instance: 'test-passmower' })
        operator = new KubeOIDCClientOperator(provider, adapter)
        await operator.watchClients()
    })

    it('claims an unclaimed client, creates its secret and caches it in Redis', async () => {
        adapter.seed('OIDCClient', rawClient('app-a'))
        await adapter.fireWatch('ADDED', 'OIDCClient', 'app-a')

        // claimed: status.instance set on the stored CR
        expect(adapter.list('OIDCClient')[0].status.instance).toBe('test-passmower')
        // secret created
        expect(adapter.secrets.get('apps/oidc-client-app-a-owner-secrets')).toBeTruthy()
        // cached in Redis with a generated secret
        const cached = await clientRedis().find(idOf('app-a'))
        expect(cached).toBeTruthy()
        expect(cached.client_secret).toBeTruthy()
    })

    it('creates the secretRefreshJob when configured (#69/#70)', async () => {
        adapter.seed('OIDCClient', rawClient('app-b', { secretRefreshJobSpec: refreshJobSpec }))
        await adapter.fireWatch('ADDED', 'OIDCClient', 'app-b')

        expect(adapter.jobs).toHaveLength(1)
        const job = adapter.jobs[0].jobManifest
        expect(job.kind).toBe('Job')
        expect(job.spec.template.spec.containers[0].image).toBe('busybox')
        // Job gets a restartPolicy (so failures are retried) and alerting labels
        expect(job.spec.template.spec.restartPolicy).toBe('OnFailure')
        expect(job.metadata.labels['app.kubernetes.io/component']).toBe('secret-refresh')
        expect(job.metadata.labels['codemowers.cloud/oidc-client']).toBe('app-b')
        // owner reference back to the OIDCClient so the Job is GC'd with it
        expect(job.metadata.ownerReferences[0].name).toBe('app-b')
    })

    it('fires the refresh job again on update', async () => {
        adapter.seed('OIDCClient', rawClient('app-c', { secretRefreshJobSpec: refreshJobSpec }))
        await adapter.fireWatch('ADDED', 'OIDCClient', 'app-c')
        const afterCreate = adapter.jobs.length
        await adapter.fireWatch('MODIFIED', 'OIDCClient', 'app-c')
        expect(adapter.jobs.length).toBe(afterCreate + 1)
    })

    it('removes the client from Redis on delete', async () => {
        adapter.seed('OIDCClient', rawClient('app-d'))
        await adapter.fireWatch('ADDED', 'OIDCClient', 'app-d')
        expect(await clientRedis().find(idOf('app-d'))).toBeTruthy()

        await adapter.fireWatch('DELETED', 'OIDCClient', 'app-d')
        expect(await clientRedis().find(idOf('app-d'))).toBeUndefined()
    })
})
