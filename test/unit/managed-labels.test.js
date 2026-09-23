import {afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi} from 'vitest'
import {fileURLToPath} from 'node:url'
import {readFileSync} from 'node:fs'
import {KubernetesAdapter} from '../../src/adapters/kubernetes.js'
import {ClaimedBy} from '../../src/conditions/claimed-by.js'
import {
    parseManagedResourceLabels,
    withManagedJobLabels,
    withManagedLabels,
} from '../../src/utils/kubernetes/managed-labels.js'

describe('parseManagedResourceLabels', () => {
    it('is empty when unset or blank', () => {
        expect(parseManagedResourceLabels(undefined)).toEqual({})
        expect(parseManagedResourceLabels('  ')).toEqual({})
    })

    it('parses a JSON object of string values', () => {
        expect(parseManagedResourceLabels('{"team":"idp","cost-center":"a1"}'))
            .toEqual({team: 'idp', 'cost-center': 'a1'})
    })

    // A typo in the chart value should stop the pod at boot, not surface as
    // unlabelled resources that an admission policy rejects later.
    it.each([
        ['not JSON', '{team: idp}', /not valid JSON/],
        ['an array', '["team"]', /must be a JSON object/],
        ['null', 'null', /must be a JSON object/],
        ['a non-string value', '{"replicas":3}', /"replicas" must be a string/],
    ])('rejects %s', (_, raw, message) => {
        expect(() => parseManagedResourceLabels(raw)).toThrow(message)
    })
})

describe('withManagedLabels', () => {
    it('passes the caller\'s labels through untouched when nothing is configured', () => {
        const labels = {a: 'b'}
        expect(withManagedLabels({}, labels)).toBe(labels)
        expect(withManagedLabels({}, undefined)).toBeUndefined()
        expect(withManagedLabels(undefined, labels)).toBe(labels)
    })

    // Passmower finds its objects again by these labels; a managed label with
    // the same key must never replace one.
    it('lets Passmower\'s own labels win on collisions', () => {
        const claimed = new ClaimedBy('passmower-passmower').setStatus(true).toLabels()
        expect(withManagedLabels(
            {team: 'idp', 'codemowers.cloud/claimed-by': 'someone-else'},
            claimed,
        )).toEqual({team: 'idp', 'codemowers.cloud/claimed-by': 'passmower-passmower'})
    })
})

describe('withManagedJobLabels', () => {
    const job = {
        metadata: {name: 'grafana-secret-refresh-1', labels: {'app.kubernetes.io/component': 'secret-refresh'}},
        spec: {template: {metadata: {labels: {app: 'refresh'}}, spec: {containers: []}}},
    }

    it('labels the Job and its pod template, the caller winning on both', () => {
        const labelled = withManagedJobLabels({team: 'idp', app: 'ignored'}, job)
        expect(labelled.metadata.labels).toEqual({team: 'idp', app: 'ignored', 'app.kubernetes.io/component': 'secret-refresh'})
        expect(labelled.spec.template.metadata.labels).toEqual({team: 'idp', app: 'refresh'})
        expect(labelled.spec.template.spec).toBe(job.spec.template.spec)
    })

    it('labels a pod template that had no metadata', () => {
        const labelled = withManagedJobLabels({team: 'idp'}, {metadata: {name: 'hook'}, spec: {template: {spec: {}}}})
        expect(labelled.spec.template.metadata.labels).toEqual({team: 'idp'})
    })

    it('does not modify the manifest it was given', () => {
        const before = structuredClone(job)
        withManagedJobLabels({team: 'idp'}, job)
        expect(job).toEqual(before)
    })

    it('returns the manifest as-is when nothing is configured', () => {
        expect(withManagedJobLabels({}, job)).toBe(job)
    })
})

// Everything Passmower creates at runtime goes through these adapter calls, so
// they are where the labels have to land.
describe('KubernetesAdapter with MANAGED_RESOURCE_LABELS', () => {
    const kubeconfig = process.env.KUBECONFIG
    let adapter

    beforeAll(() => {
        process.env.KUBECONFIG = fileURLToPath(new URL('../fixtures/kubeconfig.yaml', import.meta.url))
    })
    afterAll(() => {
        if (kubeconfig === undefined) delete process.env.KUBECONFIG
        else process.env.KUBECONFIG = kubeconfig
    })
    beforeEach(() => {
        globalThis.logger = {error: vi.fn()}
        process.env.MANAGED_RESOURCE_LABELS = '{"team":"idp"}'
        adapter = new KubernetesAdapter()
    })
    afterEach(() => {
        delete process.env.MANAGED_RESOURCE_LABELS
    })

    it('fails to construct on a malformed value', () => {
        process.env.MANAGED_RESOURCE_LABELS = 'team=idp'
        expect(() => new KubernetesAdapter()).toThrow(/MANAGED_RESOURCE_LABELS/)
    })

    it('labels custom resources beneath the caller\'s labels', async () => {
        adapter.customObjectsApi = {createNamespacedCustomObject: vi.fn().mockImplementation(async ({body}) => body)}
        await adapter.createNamespacedCustomObject(
            'OIDCUser', 'passmower', 'alice', {spec: {}}, (r) => r, undefined,
            {'codemowers.cloud/claimed-by': 'passmower-passmower'},
        )
        const {body} = adapter.customObjectsApi.createNamespacedCustomObject.mock.calls[0][0]
        expect(body.metadata.labels).toEqual({team: 'idp', 'codemowers.cloud/claimed-by': 'passmower-passmower'})
    })

    it('labels created Secrets, secretMetadata labels winning', async () => {
        adapter.coreV1Api = {createNamespacedSecret: vi.fn().mockImplementation(async ({body}) => ({data: body.data}))}
        await adapter.createSecret('default', 'oidc-client-grafana-owner-secrets', {}, {labels: {team: 'grafana'}, annotations: {a: 'b'}})
        const {body} = adapter.coreV1Api.createNamespacedSecret.mock.calls[0][0]
        expect(body.metadata.labels).toEqual({team: 'grafana'})
        expect(body.metadata.annotations).toEqual({a: 'b'})
    })

    // Secrets are converged on every reconcile; without the managed labels in
    // the desired state the next patch would strip them again.
    it('keeps managed labels on a Secret across a patch', async () => {
        adapter.coreV1Api = {patchNamespacedSecret: vi.fn().mockResolvedValue({data: {}})}
        const existing = {metadata: {labels: {team: 'idp'}}, data: {}}
        await adapter.patchSecret('default', 'oidc-client-grafana-owner-secrets', {}, {}, existing)
        const {body} = adapter.coreV1Api.patchNamespacedSecret.mock.calls[0][0]
        expect(body.filter((op) => op.path.startsWith('/metadata'))).toEqual([])
    })

    it('adds managed labels to an existing unlabelled Secret', async () => {
        adapter.coreV1Api = {patchNamespacedSecret: vi.fn().mockResolvedValue({data: {}})}
        await adapter.patchSecret('default', 'oidc-client-grafana-owner-secrets', {}, {}, {metadata: {}, data: {}})
        const {body} = adapter.coreV1Api.patchNamespacedSecret.mock.calls[0][0]
        expect(body).toContainEqual({op: 'add', path: '/metadata/labels', value: {team: 'idp'}})
    })

    it('labels Jobs and their pods', async () => {
        adapter.batchV1Api = {createNamespacedJob: vi.fn().mockResolvedValue({status: {}})}
        await adapter.createJob('default', {metadata: {name: 'hook'}, spec: {template: {spec: {}}}})
        const {body} = adapter.batchV1Api.createNamespacedJob.mock.calls[0][0]
        expect(body.metadata.labels).toEqual({team: 'idp'})
        expect(body.spec.template.metadata.labels).toEqual({team: 'idp'})
    })

    it('leaves a Secret patch unchanged when nothing is configured', async () => {
        delete process.env.MANAGED_RESOURCE_LABELS
        adapter = new KubernetesAdapter()
        adapter.coreV1Api = {patchNamespacedSecret: vi.fn().mockResolvedValue({data: {}})}
        await adapter.patchSecret('default', 'oidc-client-grafana-owner-secrets', {}, {}, {metadata: {}, data: {}})
        const {body} = adapter.coreV1Api.patchNamespacedSecret.mock.calls[0][0]
        expect(body).toEqual([])
    })
})

describe('the chart wiring for managed resource labels', () => {
    const url = (file) => new URL(`../../charts/passmower/${file}`, import.meta.url)
    const deployment = readFileSync(url('templates/deployment.yaml'), 'utf8')
    const values = readFileSync(url('values.yaml'), 'utf8')

    it('is off by default', () => {
        expect(values).toMatch(/^commonLabelsOnManagedResources: false$/m)
    })

    // app.kubernetes.io/instance is Argo CD's default tracking label: on an
    // enrolled OIDCUser it would make Argo CD prune the user as its own.
    it('never passes the chart\'s own label keys on', () => {
        const line = deployment.split('\n').find((l) => l.includes('omit .Values.commonLabels'))
        for (const key of ['helm.sh/chart', 'app.kubernetes.io/name', 'app.kubernetes.io/instance',
            'app.kubernetes.io/version', 'app.kubernetes.io/managed-by']) {
            expect(line).toContain(`"${key}"`)
        }
    })
})
