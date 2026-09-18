import {readFileSync} from 'node:fs'
import {load, loadAll} from 'js-yaml'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'
import {FakeKubernetesAdapter} from '../fakes/fake-kubernetes-adapter.js'
import {KubeOIDCClientOperator} from '../../src/operators/kube-oidc-client-operator.js'
import {KubeIngressDiscoveryOperator} from '../../src/operators/kube-ingress-discovery-operator.js'
import {resolveIngressRef} from '../../src/utils/kubernetes/resolve-ingress-ref.js'

class FakeRedisAdapter {
    records = new Map()

    async find(id) { return this.records.get(id) }
    async upsert(id, value) { this.records.set(id, value) }
    async destroy(id) { this.records.delete(id) }
}

const ingress = (host = 'grafana.example.com', name = 'grafana') => ({
    metadata: {name, namespace: 'apps', uid: `uid-${name}`},
    spec: {rules: [].concat(host).map(h => ({host: h}))},
})

const clientWithRef = (name = 'grafana', {ingressName = 'grafana', paths = ['/login/generic_oauth']} = {}) => ({
    metadata: {name, namespace: 'apps', generation: 1, uid: `uid-${name}`, resourceVersion: '1'},
    spec: {
        grantTypes: ['authorization_code'], responseTypes: ['code'],
        availableScopes: ['openid'],
        ingressRef: {name: ingressName},
        redirectPaths: paths,
    },
    status: {},
})

describe('resolving an ingressRef', () => {
    it('builds the uri and redirect URIs from the host', () => {
        expect(resolveIngressRef(ingress(), ['/login/generic_oauth', '/other'])).toEqual({
            uri: 'https://grafana.example.com/',
            redirectUris: [
                'https://grafana.example.com/login/generic_oauth',
                'https://grafana.example.com/other',
            ],
        })
    })

    it('says what it could not resolve rather than returning something empty', () => {
        expect(resolveIngressRef(undefined, ['/cb']).problems)
            .toEqual(['the referenced Ingress does not exist'])
        expect(resolveIngressRef({spec: {rules: []}}, ['/cb']).problems)
            .toEqual(['the referenced Ingress has no host in spec.rules'])
        expect(resolveIngressRef(ingress(), []).problems)
            .toEqual(['spec.redirectPaths is empty, so no redirect URI can be built'])
        expect(resolveIngressRef(ingress(['a.example.com', 'b.example.com']), ['/cb']).problems[0])
            .toMatch(/has 2 hosts/)
    })
})

describe('a client that takes its host from an Ingress', () => {
    let adapter, redis, operator

    beforeEach(async () => {
        vi.stubEnv('INGRESS_DISCOVERY_ENABLED', 'true')
        globalThis.logger = {debug() {}, info() {}, warn() {}, error() {}, trace() {}}
        adapter = new FakeKubernetesAdapter({namespace: 'apps', instance: 'test-passmower'})
        adapter.deployment = 'passmower'
        redis = new FakeRedisAdapter()
        operator = new KubeOIDCClientOperator(
            {urlFor: endpoint => `https://id.example.com/${endpoint}`}, adapter, redis)
        await operator.watchClients()
    })
    afterEach(() => vi.unstubAllEnvs())

    it('registers the resolved redirect URI', async () => {
        adapter.seed('Ingress', ingress())
        adapter.seed('OIDCClient', clientWithRef())

        await adapter.fireWatch('ADDED', 'OIDCClient', 'grafana')

        const record = redis.records.get('apps.grafana')
        expect(record.redirect_uris).toEqual(['https://grafana.example.com/login/generic_oauth'])
        expect(record.uri).toBe('https://grafana.example.com/')
    })

    it('reports what it resolved to in status, and leaves spec alone', async () => {
        adapter.seed('Ingress', ingress())
        adapter.seed('OIDCClient', clientWithRef())

        await adapter.fireWatch('ADDED', 'OIDCClient', 'grafana')

        const stored = adapter.list('OIDCClient')[0]
        expect(stored.status.resolvedUri).toBe('https://grafana.example.com/')
        expect(stored.status.resolvedRedirectUris)
            .toEqual(['https://grafana.example.com/login/generic_oauth'])
        // Writing the resolution into spec would make the operator fight
        // whatever wrote the resource, which for a hand-written client is Git.
        expect(stored.spec.uri).toBeUndefined()
        expect(stored.spec.redirectUris).toBeUndefined()
    })

    it('refuses to register a client whose Ingress is missing', async () => {
        adapter.seed('OIDCClient', clientWithRef())

        await adapter.fireWatch('ADDED', 'OIDCClient', 'grafana')

        // A client registered with no redirect URI would fail logins with a
        // mismatch, which is harder to place than a condition saying this.
        expect(adapter.list('OIDCClient')[0].status.conditions).toContainEqual(
            expect.objectContaining({type: 'Ready', status: 'False', reason: 'IngressRefUnresolved'}))
        expect(redis.records.size).toBe(0)
    })

    it('says so when Ingress access is not enabled', async () => {
        vi.stubEnv('INGRESS_DISCOVERY_ENABLED', 'false')
        adapter.seed('Ingress', ingress())
        adapter.seed('OIDCClient', clientWithRef())

        await adapter.fireWatch('ADDED', 'OIDCClient', 'grafana')

        expect(adapter.list('OIDCClient')[0].status.conditions).toContainEqual(
            expect.objectContaining({
                type: 'Ready', status: 'False', reason: 'IngressRefUnresolved',
                message: expect.stringContaining('passmower.ingressDiscovery.enabled'),
            }))
    })

    it('leaves a client with its own redirectUris untouched', async () => {
        adapter.seed('OIDCClient', {
            metadata: {name: 'plain', namespace: 'apps', generation: 1, uid: 'u', resourceVersion: '1'},
            spec: {grantTypes: ['authorization_code'], responseTypes: ['code'],
                availableScopes: ['openid'], redirectUris: ['https://plain.example.com/cb']},
            status: {},
        })

        await adapter.fireWatch('ADDED', 'OIDCClient', 'plain')

        expect(redis.records.get('apps.plain').redirect_uris)
            .toEqual(['https://plain.example.com/cb'])
        expect(adapter.list('OIDCClient')[0].status.resolvedUri).toBeUndefined()
    })
})

describe('a changed Ingress host', () => {
    it('is picked up by the clients that resolve theirs from it', async () => {
        vi.stubEnv('INGRESS_DISCOVERY_ENABLED', 'true')
        globalThis.logger = {debug() {}, info() {}, warn() {}, error() {}, trace() {}}
        const adapter = new FakeKubernetesAdapter({namespace: 'apps', instance: 'test-passmower'})
        adapter.deployment = 'passmower'
        const redis = new FakeRedisAdapter()
        const clientOperator = new KubeOIDCClientOperator(
            {urlFor: endpoint => `https://id.example.com/${endpoint}`}, adapter, redis)
        await clientOperator.watchClients()
        adapter.seed('Ingress', ingress())
        adapter.seed('OIDCClient', clientWithRef())
        await adapter.fireWatch('ADDED', 'OIDCClient', 'grafana')
        expect(redis.records.get('apps.grafana').redirect_uris)
            .toEqual(['https://grafana.example.com/login/generic_oauth'])

        // A separate adapter, as the discovery operator gets in app.js: one
        // watch per adapter.
        const discoveryAdapter = new FakeKubernetesAdapter({namespace: 'apps', instance: 'test-passmower'})
        discoveryAdapter.store = adapter.store
        const discovery = new KubeIngressDiscoveryOperator(discoveryAdapter, clientOperator)
        await discovery.watchIngresses()

        // Renaming the host does not touch the client, so its generation does
        // not move and the operator's own fingerprint check would skip it.
        adapter.seed('Ingress', ingress('renamed.example.com'))
        await discoveryAdapter.fireWatch('MODIFIED', 'Ingress', 'grafana')

        expect(redis.records.get('apps.grafana').redirect_uris)
            .toEqual(['https://renamed.example.com/login/generic_oauth'])
        expect(adapter.list('OIDCClient')[0].status.resolvedUri).toBe('https://renamed.example.com/')
        vi.unstubAllEnvs()
    })
})

describe('the CRD for ingressRef', () => {
    const crd = loadAll(readFileSync(
        new URL('../../charts/passmower/templates/crds.yaml', import.meta.url), 'utf8'))
        .find(doc => doc?.metadata?.name === 'oidcclients.codemowers.cloud')

    it.each(crd.spec.versions.map(version => version.name))('declares it on %s', (versionName) => {
        const schema = crd.spec.versions.find(v => v.name === versionName)
            .schema.openAPIV3Schema.properties.spec

        expect(schema.properties.ingressRef.required).toEqual(['name'])
        // No namespace field, deliberately: pointing at another namespace's
        // Ingress would let a client claim a hostname it does not own.
        expect(Object.keys(schema.properties.ingressRef.properties)).toEqual(['name'])
        expect(schema.properties.redirectPaths.items.type).toBe('string')
        // redirectUris can no longer be required outright, so a CEL rule keeps
        // one of the two forms mandatory.
        expect(schema.required).not.toContain('redirectUris')
        expect(schema['x-kubernetes-validations'][0].rule)
            .toBe('has(self.redirectUris) != (has(self.ingressRef) && has(self.redirectPaths))')
    })

    it('keeps the chart values documenting that this needs Ingress access', () => {
        const values = load(readFileSync(
            new URL('../../charts/passmower/values.yaml', import.meta.url), 'utf8'))

        expect(values.passmower.ingressDiscovery.enabled).toBe(false)
    })
})
