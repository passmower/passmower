import {readFileSync} from 'node:fs'
import {loadAll} from 'js-yaml'
import {beforeEach, describe, expect, it} from 'vitest'
import {FakeKubernetesAdapter} from '../fakes/fake-kubernetes-adapter.js'
import {KubeIngressDiscoveryOperator} from '../../src/operators/kube-ingress-discovery-operator.js'
import {
    discoveryProblems,
    oidcClientSpecFor,
    requestsDiscovery,
} from '../../src/utils/kubernetes/ingress-oidc-client.js'

const ingress = (annotations, {hosts = ['grafana.example.com'], name = 'grafana'} = {}) => ({
    metadata: {name, namespace: 'apps', uid: `uid-${name}`, annotations},
    spec: {rules: hosts.map(host => ({host, http: {paths: []}}))},
})

// The annotations from the issue, verbatim.
const REPORTED = {
    'codemowers.io/oidc-display-name': 'Grafana',
    'codemowers.io/oidc-redirect-path': '/login/generic_oauth',
    'codemowers.io/oidc-allowed-groups': 'k-space:floor,k-space:foobar',
}

describe('reading an Ingress', () => {
    it('derives a client from the annotations in the report', () => {
        expect(requestsDiscovery(ingress(REPORTED))).toBe(true)
        expect(discoveryProblems(ingress(REPORTED))).toEqual([])
        expect(oidcClientSpecFor(ingress(REPORTED))).toEqual({
            displayName: 'Grafana',
            uri: 'https://grafana.example.com/',
            redirectUris: ['https://grafana.example.com/login/generic_oauth'],
            grantTypes: ['authorization_code'],
            responseTypes: ['code'],
            availableScopes: ['openid'],
            allowedGroups: ['k-space:floor', 'k-space:foobar'],
        })
    })

    it('ignores an Ingress with no oidc annotations', () => {
        expect(requestsDiscovery(ingress({'kubernetes.io/ingress.class': 'nginx'}))).toBe(false)
        expect(requestsDiscovery(ingress({}))).toBe(false)
        expect(requestsDiscovery({metadata: {name: 'x'}})).toBe(false)
    })

    it('takes the display name from the Ingress when none is annotated', () => {
        const spec = oidcClientSpecFor(ingress({'codemowers.io/oidc-redirect-path': '/cb'}))

        expect(spec.displayName).toBe('grafana')
    })

    it('accepts several redirect paths and overridden types and scopes', () => {
        const spec = oidcClientSpecFor(ingress({
            'codemowers.io/oidc-redirect-path': '/cb, /auth/callback',
            'codemowers.io/oidc-available-scopes': 'openid,profile,email',
            'codemowers.io/oidc-grant-types': 'authorization_code,refresh_token',
            'codemowers.io/oidc-allowed-users': 'alice,bob',
        }))

        expect(spec.redirectUris).toEqual([
            'https://grafana.example.com/cb',
            'https://grafana.example.com/auth/callback',
        ])
        expect(spec.availableScopes).toEqual(['openid', 'profile', 'email'])
        expect(spec.grantTypes).toEqual(['authorization_code', 'refresh_token'])
        expect(spec.allowedUsers).toEqual(['alice', 'bob'])
    })

    it('refuses what it cannot derive rather than guessing', () => {
        expect(discoveryProblems(ingress({'codemowers.io/oidc-display-name': 'Grafana'})))
            .toEqual(['codemowers.io/oidc-redirect-path is required'])
        expect(discoveryProblems(ingress(REPORTED, {hosts: []})))
            .toContain('no host in spec.rules to build a redirect URI from')
        // Which host an application authenticates on is not a good thing to
        // guess at, so several hosts is refused rather than resolved.
        expect(discoveryProblems(ingress(REPORTED, {hosts: ['a.example.com', 'b.example.com']}))[0])
            .toMatch(/2 hosts in spec.rules; discovery supports one/)
    })
})

describe('discovering an application from an Ingress', () => {
    let adapter, operator

    const clientOf = (name = 'grafana') => adapter.store.get(`OIDCClient/${name}`)
    const reconcile = async (obj, type = 'ADDED') => {
        adapter.watchParameters.namespaceFilter = {filter: () => true, namespace: 'apps'}
        const callback = type === 'ADDED'
            ? adapter.watchParameters.addedCallback
            : adapter.watchParameters.modifiedCallback
        await callback(obj)
    }

    beforeEach(async () => {
        globalThis.logger = {debug() {}, info() {}, warn() {}, error() {}, trace() {}}
        adapter = new FakeKubernetesAdapter({namespace: 'apps', instance: 'test-passmower'})
        operator = new KubeIngressDiscoveryOperator(adapter)
        await operator.watchIngresses()
    })

    it('creates an OIDCClient owned by the Ingress', async () => {
        await reconcile(ingress(REPORTED))

        const client = clientOf()
        expect(client.spec.uri).toBe('https://grafana.example.com/')
        expect(client.spec.allowedGroups).toEqual(['k-space:floor', 'k-space:foobar'])
        // The ownerReference is what removes the client when the Ingress goes,
        // so discovery never leaves an orphan behind.
        expect(client.metadata.ownerReferences).toEqual([expect.objectContaining({
            kind: 'Ingress', name: 'grafana', uid: 'uid-grafana',
            apiVersion: 'networking.k8s.io/v1',
        })])
        expect(client.metadata.labels['codemowers.cloud/discovered-from']).toBe('Ingress.grafana')
        expect(adapter.events).toEqual([expect.objectContaining({
            reason: 'OIDCClientDiscovered', type: 'Normal',
        })])
    })

    it('updates the client when an annotation changes', async () => {
        await reconcile(ingress(REPORTED))
        await reconcile(ingress({...REPORTED, 'codemowers.io/oidc-allowed-groups': 'k-space:floor'}),
            'MODIFIED')

        expect(clientOf().spec.allowedGroups).toEqual(['k-space:floor'])
    })

    it('does nothing when nothing changed', async () => {
        await reconcile(ingress(REPORTED))
        const before = clientOf().metadata.resourceVersion

        await reconcile(ingress(REPORTED), 'MODIFIED')

        expect(clientOf().metadata.resourceVersion).toBe(before)
        expect(adapter.events).toHaveLength(1)
    })

    it('withdraws the client when the annotations are removed', async () => {
        await reconcile(ingress(REPORTED))
        expect(clientOf()).toBeDefined()

        await reconcile(ingress({'kubernetes.io/ingress.class': 'nginx'}), 'MODIFIED')

        expect(clientOf()).toBeUndefined()
        expect(adapter.events.at(-1)).toEqual(expect.objectContaining({reason: 'OIDCClientRemoved'}))
    })

    it('never touches a hand-written client of the same name', async () => {
        // The resource in Git is authoritative; an annotation must not rewrite
        // it from the side.
        adapter.seed('OIDCClient', {
            metadata: {name: 'grafana', namespace: 'apps', labels: {}},
            spec: {uri: 'https://written-by-hand.example.com/', redirectUris: ['https://x/cb'],
                grantTypes: ['authorization_code'], responseTypes: ['code']},
            status: {},
        })

        await reconcile(ingress(REPORTED))

        expect(clientOf().spec.uri).toBe('https://written-by-hand.example.com/')
        expect(adapter.events).toEqual([expect.objectContaining({
            reason: 'OIDCClientConflict', type: 'Warning',
        })])
    })

    it('reports on the Ingress what it could not derive', async () => {
        await reconcile(ingress(REPORTED, {hosts: ['a.example.com', 'b.example.com']}))

        expect(clientOf()).toBeUndefined()
        expect(adapter.events).toEqual([expect.objectContaining({
            reason: 'IngressDiscoveryFailed', type: 'Warning',
            message: expect.stringContaining('discovery supports one'),
        })])
    })

    it('leaves an unannotated Ingress alone entirely', async () => {
        await reconcile(ingress({'kubernetes.io/ingress.class': 'nginx'}))

        expect(adapter.store.size).toBe(0)
        expect(adapter.events).toEqual([])
    })
})

// A discovered client is written straight to the API server, so every field the
// mapping produces has to be one the CRD declares — an unknown key is pruned
// and an invalid enum value is rejected outright, either way leaving an Ingress
// that looks annotated and an application that cannot sign anyone in.
describe('the derived spec against the OIDCClient CRD', () => {
    const crd = loadAll(readFileSync(
        new URL('../../charts/passmower/templates/crds.yaml', import.meta.url), 'utf8'))
        .find(doc => doc?.metadata?.name === 'oidcclients.codemowers.cloud')

    it.each(crd.spec.versions.map(version => version.name))('fits %s', (versionName) => {
        const schema = crd.spec.versions.find(v => v.name === versionName)
            .schema.openAPIV3Schema.properties.spec
        const spec = oidcClientSpecFor(ingress({
            ...REPORTED,
            'codemowers.io/oidc-available-scopes': 'openid,profile,email',
            'codemowers.io/oidc-allowed-users': 'alice',
        }))

        expect(Object.keys(spec).filter(key => !(key in schema.properties))).toEqual([])
        for (const required of schema.required) {
            expect(spec[required]).toBeDefined()
        }
        for (const field of ['availableScopes', 'grantTypes', 'responseTypes']) {
            expect(schema.properties[field].items.enum).toEqual(expect.arrayContaining(spec[field]))
        }
    })
})
