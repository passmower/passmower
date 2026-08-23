import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'

const store = vi.hoisted(() => ({
    records: new Map(),
    index: new Set(),
}))

vi.mock('../../src/adapters/redis.js', () => ({
    default: class RedisAdapter {
        constructor(name) {
            this.name = name
        }
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
    },
}))

import {incidentTtlSeconds, listIncidents, recordIncident} from '../../src/utils/session/incident-log.js'

const ctx = {headers: {'x-forwarded-for': '1.1.1.1, 10.0.0.1'}}
const incident = {
    source: 'oidc-login',
    accountId: 'alice',
    clientId: 'grafana',
    failure: 'client_access_required',
    allowedGroups: ['passmower:grafana-users'],
}

describe('incident log', () => {
    beforeEach(() => {
        globalThis.logger = {info: vi.fn(), warn: vi.fn(), error: vi.fn()}
        store.records.clear()
        store.index.clear()
    })

    afterEach(() => {
        vi.unstubAllEnvs()
    })

    it('honors the TTL configuration and its default', () => {
        expect(incidentTtlSeconds({})).toBe(604800)
        expect(incidentTtlSeconds({INCIDENT_TTL_SECONDS: '3600'})).toBe(3600)
        expect(incidentTtlSeconds({INCIDENT_TTL_SECONDS: 'bogus'})).toBe(604800)
    })

    it('records a denied access with the proposed-fix context', async () => {
        await recordIncident(ctx, incident)

        const [listed] = await listIncidents()
        expect(listed).toMatchObject({
            source: 'oidc-login',
            accountId: 'alice',
            clientId: 'grafana',
            failure: 'client_access_required',
            allowedGroups: ['passmower:grafana-users'],
            sourceIp: '1.1.1.1',
            count: 1,
        })
        expect(listed.firstSeenAt).toBe(listed.lastSeenAt)
    })

    it('deduplicates repeats into a counter instead of new records', async () => {
        await recordIncident(ctx, incident)
        await recordIncident(ctx, incident)
        await recordIncident(ctx, {...incident, clientId: 'harbor'})

        const listed = await listIncidents()
        expect(listed).toHaveLength(2)
        expect(listed.find(i => i.clientId === 'grafana').count).toBe(2)
        expect(listed.find(i => i.clientId === 'harbor').count).toBe(1)
    })

    it('drops dangling index entries for expired records', async () => {
        await recordIncident(ctx, incident)
        store.records.clear() // simulate TTL expiry

        await expect(listIncidents()).resolves.toEqual([])
        expect(store.index.size).toBe(0)
    })

    it('can be disabled and never throws into the login flow', async () => {
        vi.stubEnv('INCIDENTS_ENABLED', 'false')
        await recordIncident(ctx, incident)
        expect(store.records.size).toBe(0)

        vi.unstubAllEnvs()
        store.records.set = () => { throw new Error('redis down') }
        await expect(recordIncident(ctx, incident)).resolves.toBeUndefined()
        expect(globalThis.logger.warn).toHaveBeenCalled()
    })
})
