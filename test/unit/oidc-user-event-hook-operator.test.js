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

// The operator keeps the generation each user was last dispatched at in Redis,
// so that a restart or a leader handover does not replay every user as new.
class FakeStateRedis {
    records = new Map()

    async find(id) { return this.records.get(id) }
    async upsert(id, value) { this.records.set(id, value) }
    async destroy(id) { this.records.delete(id) }
}

describe('KubeOidcUserEventHookOperator', () => {
    let adapter, state

    beforeEach(() => {
        globalThis.logger = {error: vi.fn(), info: vi.fn(), warn: vi.fn()}
        adapter = new FakeKubernetesAdapter({namespace: 'users'})
        adapter.seed('OIDCUserEventHook', rawHook())
        state = new FakeStateRedis()
    })

    async function operator(stateRedis = state) {
        const result = new KubeOidcUserEventHookOperator(adapter, stateRedis)
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

    it('classifies an advanced generation replayed after a watch gap as Modified', async () => {
        await operator()
        adapter.seed('OIDCUser', rawUser())
        await adapter.fireWatch('ADDED', 'OIDCUser', 'alice')
        adapter.seed('OIDCUser', rawUser('alice', 2))

        // A re-established Kubernetes watch reports existing resources as
        // ADDED even when their spec changed while the watch was disconnected.
        await adapter.fireWatch('ADDED', 'OIDCUser', 'alice')

        expect(adapter.jobs.map(item => item.jobManifest.metadata.labels['codemowers.cloud/event']))
            .toEqual(['added', 'modified'])
        expect(adapter.list('OIDCUserEventHook')[0].status.lastAttemptedJob).toMatchObject({
            event: 'Modified', generation: 2,
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
    // Without a durable store this is where every user would look new again. A
    // leader handover does exactly what a restart does, so once the operators
    // are leader-elected this stops being a rare event (#236).
    it('does not replay Added for known users when the process restarts', async () => {
        await operator()
        adapter.seed('OIDCUser', rawUser())
        await adapter.fireWatch('ADDED', 'OIDCUser', 'alice')
        expect(adapter.jobs).toHaveLength(1)

        // A second operator on the same state, as a new leader would be.
        await operator()
        await adapter.fireWatch('ADDED', 'OIDCUser', 'alice')

        expect(adapter.jobs).toHaveLength(1)
    })

    it('still reports a user created while nothing was watching as Added', async () => {
        await operator()
        adapter.seed('OIDCUser', rawUser('bob'))

        await operator()
        await adapter.fireWatch('ADDED', 'OIDCUser', 'bob')

        expect(adapter.jobs.map(item => item.jobManifest.metadata.labels['codemowers.cloud/event']))
            .toEqual(['added'])
    })

    // The upgrade that introduces the store would otherwise be one big cold
    // start: every existing user dispatched as Added, once.
    it('seeds existing users on first run without dispatching', async () => {
        adapter.seed('OIDCUser', rawUser('alice'))
        adapter.seed('OIDCUser', rawUser('bob'))

        await operator()
        await adapter.fireWatch('ADDED', 'OIDCUser', 'alice')
        await adapter.fireWatch('ADDED', 'OIDCUser', 'bob')

        expect(adapter.jobs).toHaveLength(0)
    })

    // Seeding off a failed listing would suppress a real Added for every user
    // it should have seen, so it has to be retried rather than marked done.
    it('does not mark the store seeded when the listing fails', async () => {
        adapter.seed('OIDCUser', rawUser('alice'))
        const list = adapter.listNamespacedCustomObject.bind(adapter)
        adapter.listNamespacedCustomObject = async (kind, ...rest) =>
            kind === 'OIDCUser' ? null : list(kind, ...rest)

        await operator()
        expect(state.records.size).toBe(0)

        adapter.listNamespacedCustomObject = list
        await operator()
        await adapter.fireWatch('ADDED', 'OIDCUser', 'alice')

        expect(adapter.jobs).toHaveLength(0)
    })
})
