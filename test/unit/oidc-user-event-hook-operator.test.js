import {beforeEach, describe, expect, it, vi} from 'vitest'
import {FakeKubernetesAdapter} from '../fakes/fake-kubernetes-adapter.js'
import {KubeOidcUserEventHookOperator} from '../../src/operators/kube-oidc-user-event-hook-operator.js'

function rawHook(name = 'sync', overrides = {}) {
    return {
        metadata: {name, namespace: 'users', uid: `uid-${name}`},
        spec: {
            events: ['Added', 'Modified', 'Deleted'],
            selector: {matchLabels: {tenant: 'acme'}},
            jobSpec: {template: {spec: {containers: [{name: 'sync', image: 'busybox'}]}}},
            ...overrides,
        },
    }
}

function rawUser(name = 'alice', generation = 1, labels = {tenant: 'acme'}) {
    return {
        metadata: {name, namespace: 'users', uid: `uid-${name}`, generation, labels},
        spec: {type: 'person', email: `${name}@example.com`},
        status: {},
    }
}

describe('KubeOidcUserEventHookOperator', () => {
    let adapter

    beforeEach(() => {
        globalThis.logger = {error: vi.fn(), info: vi.fn(), warn: vi.fn()}
        adapter = new FakeKubernetesAdapter({namespace: 'users'})
        adapter.seed('OIDCUserEventHook', rawHook())
    })

    async function operator() {
        const result = new KubeOidcUserEventHookOperator(adapter)
        await result.watchUsers()
        return result
    }

    it('creates Jobs for Added, generation-changing Modified, and Deleted events', async () => {
        await operator()
        adapter.seed('OIDCUser', rawUser())
        await adapter.fireWatch('ADDED', 'OIDCUser', 'alice')
        adapter.seed('OIDCUser', rawUser('alice', 2))
        await adapter.fireWatch('MODIFIED', 'OIDCUser', 'alice')
        await adapter.fireWatch('DELETED', 'OIDCUser', 'alice')

        expect(adapter.jobs.map(item => item.jobManifest.metadata.labels['codemowers.cloud/event']))
            .toEqual(['added', 'modified', 'deleted'])
        expect(adapter.jobs.every(item => item.namespace === 'users')).toBe(true)
        expect(adapter.list('OIDCUserEventHook')[0].status).toMatchObject({
            lastAttemptedJob: {event: 'Deleted', userName: 'alice', generation: 2},
            conditions: [{type: 'Ready', status: 'True', reason: 'JobCreated'}],
        })
    })

    it('does not create Jobs for status-only changes or reconnect replays at the current generation', async () => {
        await operator()
        adapter.seed('OIDCUser', rawUser())
        await adapter.fireWatch('ADDED', 'OIDCUser', 'alice')
        await adapter.fireWatch('MODIFIED', 'OIDCUser', 'alice')
        await adapter.fireWatch('ADDED', 'OIDCUser', 'alice')
        adapter.seed('OIDCUser', rawUser('alice', 2))
        await adapter.fireWatch('MODIFIED', 'OIDCUser', 'alice')
        await adapter.fireWatch('ADDED', 'OIDCUser', 'alice')

        expect(adapter.jobs).toHaveLength(2)
        expect(adapter.jobs.map(item => item.jobManifest.metadata.labels['codemowers.cloud/event']))
            .toEqual(['added', 'modified'])
        expect(adapter.list('OIDCUserEventHook')[0].status.conditions[0]).toMatchObject({
            status: 'True', reason: 'JobCreated',
        })
    })

    it('enforces event filters and label selectors', async () => {
        adapter.seed('OIDCUserEventHook', rawHook('added-acme', {events: ['Added']}))
        await operator()
        adapter.seed('OIDCUser', rawUser('bob', 1, {tenant: 'other'}))
        await adapter.fireWatch('ADDED', 'OIDCUser', 'bob')
        adapter.seed('OIDCUser', rawUser('alice'))
        await adapter.fireWatch('ADDED', 'OIDCUser', 'alice')
        adapter.seed('OIDCUser', rawUser('alice', 2))
        await adapter.fireWatch('MODIFIED', 'OIDCUser', 'alice')

        const jobsByHook = adapter.jobs.map(item => item.jobManifest.metadata.labels['codemowers.cloud/oidc-user-event-hook'])
        expect(jobsByHook.filter(name => name === 'sync')).toHaveLength(2)
        expect(jobsByHook.filter(name => name === 'added-acme')).toHaveLength(1)
    })

    it('records a degraded status and emits a Warning event when Job creation fails', async () => {
        adapter.createJob = vi.fn().mockResolvedValue(null)
        await operator()
        adapter.seed('OIDCUser', rawUser())

        await adapter.fireWatch('ADDED', 'OIDCUser', 'alice')

        expect(adapter.list('OIDCUserEventHook')[0].status).toMatchObject({
            lastAttemptedJob: {event: 'Added', userName: 'alice'},
            conditions: [{type: 'Ready', status: 'False', reason: 'JobCreationFailed'}],
        })
        expect(adapter.events).toContainEqual(expect.objectContaining({
            reason: 'JobCreationFailed', type: 'Warning',
        }))
    })
})
