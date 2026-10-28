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

    function rawClient(name, { secretRefreshJobSpec, disabled = false, description, status = {} } = {}) {
        return {
            metadata: {
                name, namespace: 'apps', resourceVersion: '1', generation: disabled ? 2 : 1, uid: `uid-${name}`,
                annotations: description ? {'kubernetes.io/description': description} : {},
            },
            spec: {
                grantTypes: ['authorization_code'],
                responseTypes: ['code'],
                redirectUris: ['https://app.example.com/cb'],
                availableScopes: ['openid'],
                tokenEndpointAuthMethod: 'client_secret_basic',
                disabled,
                ...(secretRefreshJobSpec ? { secretRefreshJobSpec } : {}),
            },
            status,
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
        const configured = await provider.Client.find(idOf('app-a'))
        expect(configured.clientNamespace).toBe('apps')
        expect(configured.clientName).toBe('app-a')
        expect(configured.kind).toBe('OIDCClient')
        expect(adapter.list('OIDCClient')[0].status.conditions).toContainEqual(expect.objectContaining({
            type: 'Ready', status: 'True', reason: 'Reconciled',
        }))
        expect(adapter.events).toContainEqual(expect.objectContaining({
            reason: 'Reconciled', type: 'Normal',
        }))
    })

    it('creates the secretRefreshJob when configured (#69/#70)', async () => {
        adapter.seed('OIDCClient', rawClient('app-b', { secretRefreshJobSpec: refreshJobSpec }))
        await adapter.fireWatch('ADDED', 'OIDCClient', 'app-b')

        expect(adapter.jobs).toHaveLength(1)
        const job = adapter.jobs[0].jobManifest
        expect(job.kind).toBe('Job')
        expect(job.spec.template.spec.containers[0].image).toBe('busybox')
        // Job gets a restartPolicy (so failures are retried), a TTL (so finished
        // Jobs are reaped) and alerting labels
        expect(job.spec.template.spec.restartPolicy).toBe('OnFailure')
        expect(job.spec.ttlSecondsAfterFinished).toBe(3600)
        expect(job.metadata.labels['app.kubernetes.io/component']).toBe('secret-refresh')
        expect(job.metadata.labels['codemowers.cloud/oidc-client']).toBe('app-b')
        // owner reference back to the OIDCClient so the Job is GC'd with it
        expect(job.metadata.ownerReferences[0].name).toBe('app-b')
    })

    it('fires the refresh job again on update', async () => {
        adapter.seed('OIDCClient', rawClient('app-c', { secretRefreshJobSpec: refreshJobSpec }))
        await adapter.fireWatch('ADDED', 'OIDCClient', 'app-c')
        const afterCreate = adapter.jobs.length
        const status = structuredClone(adapter.list('OIDCClient')[0].status)
        const modified = rawClient('app-c', {secretRefreshJobSpec: refreshJobSpec, status})
        modified.metadata.generation = 2
        adapter.seed('OIDCClient', modified)
        await adapter.fireWatch('MODIFIED', 'OIDCClient', 'app-c')
        expect(adapter.jobs.length).toBe(afterCreate + 1)
    })

    it('does not refresh client material for a status-only update', async () => {
        adapter.seed('OIDCClient', rawClient('app-status', {secretRefreshJobSpec: refreshJobSpec}))
        await adapter.fireWatch('ADDED', 'OIDCClient', 'app-status')
        const jobs = adapter.jobs.length
        const events = adapter.events.length
        await adapter.fireWatch('MODIFIED', 'OIDCClient', 'app-status')
        expect(adapter.jobs).toHaveLength(jobs)
        expect(adapter.events).toHaveLength(events)
    })

    it('reconciles description annotation changes without a generation bump', async () => {
        adapter.seed('OIDCClient', rawClient('app-description', {description: 'Old description'}))
        await adapter.fireWatch('ADDED', 'OIDCClient', 'app-description')
        expect((await clientRedis().find(idOf('app-description'))).description).toBe('Old description')

        const status = structuredClone(adapter.list('OIDCClient')[0].status)
        adapter.seed('OIDCClient', rawClient('app-description', {description: 'New description', status}))
        await adapter.fireWatch('MODIFIED', 'OIDCClient', 'app-description')

        expect((await clientRedis().find(idOf('app-description'))).description).toBe('New description')
    })

    it('removes the client from Redis on delete', async () => {
        adapter.seed('OIDCClient', rawClient('app-d'))
        await adapter.fireWatch('ADDED', 'OIDCClient', 'app-d')
        expect(await clientRedis().find(idOf('app-d'))).toBeTruthy()

        await adapter.fireWatch('DELETED', 'OIDCClient', 'app-d')
        expect(await clientRedis().find(idOf('app-d'))).toBeUndefined()
    })

    it('removes a disabled client from Redis without deleting its Secret', async () => {
        adapter.seed('OIDCClient', rawClient('app-disabled'))
        await adapter.fireWatch('ADDED', 'OIDCClient', 'app-disabled')
        const secret = adapter.secrets.get('apps/oidc-client-app-disabled-owner-secrets')
        expect(await clientRedis().find(idOf('app-disabled'))).toBeTruthy()

        const status = structuredClone(adapter.list('OIDCClient')[0].status)
        adapter.seed('OIDCClient', rawClient('app-disabled', {disabled: true, status}))
        await adapter.fireWatch('MODIFIED', 'OIDCClient', 'app-disabled')

        expect(await clientRedis().find(idOf('app-disabled'))).toBeUndefined()
        expect(adapter.secrets.get('apps/oidc-client-app-disabled-owner-secrets')).toEqual(secret)
        expect(adapter.list('OIDCClient')[0].status.conditions).toContainEqual(expect.objectContaining({
            type: 'Ready', status: 'True', reason: 'Disabled',
        }))
    })

    it('reports a failed secret-refresh Job in status and a Warning event', async () => {
        adapter.createJob = async () => null
        adapter.seed('OIDCClient', rawClient('app-job-failure', {secretRefreshJobSpec: refreshJobSpec}))

        await adapter.fireWatch('ADDED', 'OIDCClient', 'app-job-failure')

        expect(adapter.list('OIDCClient')[0].status.conditions).toContainEqual(expect.objectContaining({
            type: 'Ready', status: 'False', reason: 'RefreshJobReconcileFailed',
        }))
        expect(adapter.events).toContainEqual(expect.objectContaining({
            reason: 'RefreshJobReconcileFailed', type: 'Warning',
        }))
        expect(await clientRedis().find(idOf('app-job-failure'))).toBeUndefined()
    })

    // A public client (tokenEndpointAuthMethod: none) gets no OIDC_CLIENT_SECRET
    // in its Secret (#310). These pin what that means for the reconcile, which
    // reads the client_secret back from the Secret it finds.
    describe('public clients (#310)', () => {
        const publicClient = (name, {tokenEndpointAuthMethod = 'none', resourceVersion = '1', generation = 1} = {}) => {
            const raw = rawClient(name, {secretRefreshJobSpec: refreshJobSpec})
            raw.metadata.resourceVersion = resourceVersion
            raw.metadata.generation = generation
            raw.spec.tokenEndpointAuthMethod = tokenEndpointAuthMethod
            raw.spec.pkce = true
            return raw
        }
        const secretOf = (name) => adapter.secrets.get(`apps/oidc-client-${name}-owner-secrets`)

        it('creates the Secret without OIDC_CLIENT_SECRET and still serves the client', async () => {
            adapter.seed('OIDCClient', publicClient('app-public'))
            await adapter.fireWatch('ADDED', 'OIDCClient', 'app-public')

            expect(secretOf('app-public').data).not.toHaveProperty('OIDC_CLIENT_SECRET')
            expect(secretOf('app-public').data.OIDC_CLIENT_ID).toBe(idOf('app-public'))
            const configured = await provider.Client.find(idOf('app-public'))
            expect(configured.tokenEndpointAuthMethod).toBe('none')
        })

        it('drops the secret an older version wrote, then settles without refreshing again', async () => {
            adapter.seed('OIDCClient', publicClient('app-upgraded'))
            adapter.secrets.set('apps/oidc-client-app-upgraded-owner-secrets', {
                data: {OIDC_CLIENT_ID: idOf('app-upgraded'), OIDC_CLIENT_SECRET: 'from-an-older-version'},
                metadata: {},
            })

            await adapter.fireWatch('ADDED', 'OIDCClient', 'app-upgraded')
            expect(secretOf('app-upgraded').data).not.toHaveProperty('OIDC_CLIENT_SECRET')
            const jobs = adapter.jobs.length

            // A watch replay of the same resource changes nothing.
            await adapter.fireWatch('ADDED', 'OIDCClient', 'app-upgraded')
            expect(secretOf('app-upgraded').data).not.toHaveProperty('OIDC_CLIENT_SECRET')
            expect(adapter.jobs.length).toBe(jobs)
            expect(await provider.Client.find(idOf('app-upgraded'))).toBeTruthy()
        })

        it('generates a secret when the client switches to a confidential method', async () => {
            adapter.seed('OIDCClient', publicClient('app-switch'))
            await adapter.fireWatch('ADDED', 'OIDCClient', 'app-switch')

            adapter.seed('OIDCClient', publicClient('app-switch', {
                tokenEndpointAuthMethod: 'client_secret_basic', resourceVersion: '2', generation: 2,
            }))
            await adapter.fireWatch('MODIFIED', 'OIDCClient', 'app-switch')

            const secret = secretOf('app-switch').data.OIDC_CLIENT_SECRET
            expect(secret).toBeTruthy()
            const configured = await provider.Client.find(idOf('app-switch'))
            expect(configured.tokenEndpointAuthMethod).toBe('client_secret_basic')
            expect(configured.clientSecret).toBe(secret)
        })
    })
})
