import {beforeEach, describe, expect, it} from 'vitest'
import {vi} from 'vitest'

const store = vi.hoisted(() => ({
    records: new Map(),
    index: new Set(),
}))

vi.mock('../../src/adapters/redis.js', () => ({
    default: class RedisAdapter {
        async upsert(id, payload, ttl) {
            store.records.set(id, {payload, ttl})
        }
        async find(id) {
            return store.records.get(id)?.payload
        }
        async appendToSet(id, item) {
            store.index.add(item)
        }
        async removeFromSet(id, item) {
            store.index.delete(item)
        }
        async getSetMembers() {
            return [...store.index]
        }
        async destroy(id) {
            store.records.delete(id)
        }
    },
}))

import {
    canRequestAccess,
    dismissAccessRequest,
    listAccessRequests,
    recordAccessRequest,
} from '../../src/utils/session/access-requests.js'

const member = {accountId: 'alice', groups: [{prefix: 'passmower', name: 'staff'}]}
const groupless = {accountId: 'bob', groups: []}
const client = {clientId: 'grafana', allowedGroups: ['passmower:grafana-users']}

describe('group membership requests', () => {
    beforeEach(() => {
        store.records.clear()
        store.index.clear()
    })

    it('is offered only when enabled, group-gated, and the account qualifies', () => {
        const on = {GROUP_REQUESTS_ENABLED: 'true'}
        expect(canRequestAccess(member, client, {})).toBe(false) // feature off
        expect(canRequestAccess(member, client, on)).toBe(true)
        expect(canRequestAccess(member, {clientId: 'x', allowedGroups: []}, on)).toBe(false) // nothing to request
        expect(canRequestAccess(groupless, client, on)).toBe(false) // blank enrollment
        expect(canRequestAccess(groupless, client,
            {...on, GROUP_REQUESTS_REQUIRE_EXISTING_GROUP: 'false'})).toBe(true) // relaxed
        expect(canRequestAccess(undefined, client, on)).toBe(false)
    })

    it('deduplicates repeats per account/client into a counter', async () => {
        await recordAccessRequest({accountId: 'alice', clientId: 'grafana', allowedGroups: client.allowedGroups})
        await recordAccessRequest({accountId: 'alice', clientId: 'grafana', allowedGroups: client.allowedGroups})
        await recordAccessRequest({accountId: 'alice', clientId: 'harbor', allowedGroups: ['passmower:harbor']})

        const requests = await listAccessRequests()
        expect(requests).toHaveLength(2)
        const grafana = requests.find(r => r.clientId === 'grafana')
        expect(grafana).toMatchObject({
            accountId: 'alice',
            allowedGroups: ['passmower:grafana-users'],
            count: 2,
        })
        expect(grafana.firstRequestedAt <= grafana.lastRequestedAt).toBe(true)
    })

    it('dismisses a request and drops expired index entries', async () => {
        await recordAccessRequest({accountId: 'alice', clientId: 'grafana', allowedGroups: []})
        await dismissAccessRequest('alice:grafana')
        await expect(listAccessRequests()).resolves.toEqual([])

        await recordAccessRequest({accountId: 'alice', clientId: 'grafana', allowedGroups: []})
        store.records.clear() // simulate TTL expiry
        await expect(listAccessRequests()).resolves.toEqual([])
        expect(store.index.size).toBe(0)
    })
})
