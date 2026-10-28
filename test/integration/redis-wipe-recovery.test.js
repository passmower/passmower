import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import Redis from 'ioredis'
import { FakeKubernetesAdapter } from '../fakes/fake-kubernetes-adapter.js'
import { KubeOIDCClientOperator } from '../../src/operators/kube-oidc-client-operator.js'
import { RedisWipeDetector } from '../../src/services/redis-wipe-detector.js'
import OidcClient from '../../src/models/oidc-client.js'

// A Redis that loses its data while the watches stay connected loses every
// application client, and nothing replays them until the watch ends (#309).
// The detector notices and restarts the watch, whose LIST replays each
// resource as ADDED. The fake adapter has no LIST, so the replay fires it.
describe('application clients after a Redis wipe', () => {
    let provider, adapter, operator, redis

    const rawClient = (name) => ({
        metadata: { name, namespace: 'apps', resourceVersion: '1', generation: 1, uid: `uid-${name}`, annotations: {} },
        spec: {
            grantTypes: ['authorization_code'],
            responseTypes: ['code'],
            redirectUris: ['https://app.example.com/cb'],
            availableScopes: ['openid'],
            tokenEndpointAuthMethod: 'client_secret_basic',
            secretRefreshJobSpec: { template: { spec: { containers: [{ name: 'refresh', image: 'busybox' }] } } },
        },
        status: {},
    })
    const clientId = new OidcClient().fromIncomingClient(rawClient('app-wipe')).getClientId()

    const startWatch = async () => {
        operator = new KubeOIDCClientOperator(provider, adapter)
        await operator.watchClients()
    }

    beforeAll(async () => {
        process.env.REDIS_URI ??= 'redis://127.0.0.1:6379'
        globalThis.logger = { debug() {}, info() {}, warn() {}, error() {}, trace() {} }
        const { buildProvider } = await import('../../src/app.js')
        provider = await buildProvider()
        redis = new Redis(process.env.REDIS_URI)
        adapter = new FakeKubernetesAdapter({ namespace: 'apps', instance: 'test-passmower' })
        await startWatch()
    })

    afterAll(async () => {
        redis?.disconnect()
        const { disconnect } = await import('../../src/adapters/redis.js')
        await disconnect()
    })

    it('restores the client from its resource without rotating its secret', async () => {
        adapter.seed('OIDCClient', rawClient('app-wipe'))
        await adapter.fireWatch('ADDED', 'OIDCClient', 'app-wipe')
        const before = await provider.Client.find(clientId)
        expect(before).toBeTruthy()
        const jobsBefore = adapter.jobs.length

        const detector = new RedisWipeDetector(async () => {
            operator.stop()
            await startWatch()
            await adapter.fireWatch('ADDED', 'OIDCClient', 'app-wipe')
        })
        await detector.start()
        detector.stop()
        expect(await detector.check()).toBe(false)

        await redis.flushdb()
        expect(await provider.Client.find(clientId)).toBeUndefined()

        expect(await detector.check()).toBe(true)
        const after = await provider.Client.find(clientId)
        expect(after).toBeTruthy()
        expect(after.clientSecret).toBe(before.clientSecret)
        // Same secret, so the workload has nothing to pick up.
        expect(adapter.jobs.length).toBe(jobsBefore)
        expect(await detector.check()).toBe(false)
    })
})
