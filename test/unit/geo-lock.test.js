import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'
import {fileURLToPath} from 'node:url'

const mocks = vi.hoisted(() => ({
    store: new Map(),
    upsert: vi.fn(),
    recordIncident: vi.fn(),
}))

vi.mock('../../src/adapters/redis.js', () => ({
    default: class RedisAdapter {
        constructor(name) {
            this.name = name
        }
        async find(id) {
            return mocks.store.get(`${this.name}:${id}`)
        }
        async upsert(id, payload, ttl) {
            mocks.upsert(this.name, id, payload, ttl)
            mocks.store.set(`${this.name}:${id}`, payload)
        }
    },
}))

vi.mock('../../src/utils/session/incident-log.js', () => ({
    recordIncident: mocks.recordIncident,
}))

import {enforceGeoLock, extendSessionPin, findSessionPin, pinSession} from '../../src/utils/session/geo-lock.js'
import {resetGeoipReader} from '../../src/utils/geoip.js'

const GEOIP_FIXTURE = fileURLToPath(new URL('../fixtures/geoip/GeoIP2-Country-Test.mmdb', import.meta.url))
const GB = '81.2.69.142'
const SE = '89.160.20.112'
const ctx = (ip) => ({headers: {'x-forwarded-for': `${ip}, 10.0.0.1`}})
const now = () => Math.floor(Date.now() / 1000)

describe('geo-lock session pins', () => {
    beforeEach(() => {
        resetGeoipReader()
        mocks.store.clear()
        mocks.upsert.mockReset()
        mocks.recordIncident.mockReset()
        globalThis.logger = {info: vi.fn(), error: vi.fn(), warn: vi.fn()}
        globalThis.metrics = {geoLockDenied: {inc: vi.fn()}}
        vi.stubEnv('GEOIP_DATABASE_PATH', GEOIP_FIXTURE)
        vi.stubEnv('GEO_LOCK_ENABLED', 'true')
    })

    afterEach(() => {
        vi.unstubAllEnvs()
        resetGeoipReader()
        delete globalThis.metrics
    })

    it('pins a session to the country of its first forwarded hop', async () => {
        const exp = now() + 1000
        await pinSession(ctx(GB), {uid: 'u1', exp}, {fresh: true, defaultTtl: 5})
        expect(await findSessionPin('u1')).toMatchObject({country: 'GB', ip: GB, exp})
        expect(mocks.upsert.mock.calls[0][3]).toBeGreaterThan(900)
    })

    it('keeps the pin on SSO and re-pins on a fresh authentication', async () => {
        await pinSession(ctx(GB), {uid: 'u1'}, {fresh: true, defaultTtl: 60})
        await pinSession(ctx(SE), {uid: 'u1'}, {fresh: false, defaultTtl: 60})
        expect((await findSessionPin('u1')).country).toBe('GB')
        await pinSession(ctx(SE), {uid: 'u1'}, {fresh: true, defaultTtl: 60})
        expect((await findSessionPin('u1')).country).toBe('SE')
    })

    it('pins nothing while geo-lock is off', async () => {
        vi.stubEnv('GEO_LOCK_ENABLED', 'false')
        await pinSession(ctx(GB), {uid: 'u1'}, {fresh: true, defaultTtl: 60})
        expect(await findSessionPin('u1')).toBeUndefined()
    })

    it('extends the pin when the session slides past it', async () => {
        await pinSession(ctx(GB), {uid: 'u1', exp: now() + 10}, {fresh: true})
        mocks.upsert.mockReset()
        await extendSessionPin({uid: 'u1', exp: now() + 1000})
        expect(mocks.upsert).toHaveBeenCalledWith('SessionGeo', 'u1',
            expect.objectContaining({country: 'GB', exp: now() + 1000}), expect.any(Number))
        mocks.upsert.mockReset()
        await extendSessionPin({uid: 'u1', exp: now() + 1000})
        expect(mocks.upsert).not.toHaveBeenCalled()
    })

    it('never invents a pin for a session that has none', async () => {
        await extendSessionPin({uid: 'u1', exp: now() + 1000})
        expect(mocks.upsert).not.toHaveBeenCalled()
    })

    it('treats a pin past its exp as gone', async () => {
        vi.useFakeTimers({toFake: ['Date']})
        try {
            await pinSession(ctx(GB), {uid: 'u1', exp: now() + 100}, {fresh: true})
            vi.setSystemTime(Date.now() + 101 * 1000)
            expect(await findSessionPin('u1')).toBeUndefined()
        } finally {
            vi.useRealTimers()
        }
    })

    // Regression: the pin used to be extended from a request middleware, which
    // runs before oidc-provider renews the session and so saw the old exp.
    it('keeps a renewed session pinned past its original expiry', async () => {
        vi.useFakeTimers({toFake: ['Date']})
        try {
            const t0 = now()
            await pinSession(ctx(GB), {uid: 'u1', exp: t0 + 100}, {fresh: true})
            vi.setSystemTime((t0 + 50) * 1000)
            // session.saved after the renewal carries the new exp.
            await extendSessionPin({uid: 'u1', exp: t0 + 150})
            vi.setSystemTime((t0 + 120) * 1000)
            expect(await findSessionPin('u1')).toMatchObject({country: 'GB', exp: t0 + 150})
        } finally {
            vi.useRealTimers()
        }
    })

    it('lets a request from the pinned country through silently', async () => {
        await expect(enforceGeoLock(ctx(GB), {source: 'oidc-session', pinnedCountry: 'GB', accountId: 'alice'}))
            .resolves.toBeNull()
        expect(globalThis.metrics.geoLockDenied.inc).not.toHaveBeenCalled()
        expect(mocks.recordIncident).not.toHaveBeenCalled()
    })

    it('refuses another country and records it for audit', async () => {
        await expect(enforceGeoLock(ctx(SE), {source: 'refresh', pinnedCountry: 'GB', accountId: 'alice', clientId: 'spa'}))
            .resolves.toBe('geo_lock_country')
        expect(globalThis.metrics.geoLockDenied.inc).toHaveBeenCalledWith({source: 'refresh', reason: 'geo_lock_country'})
        expect(mocks.recordIncident).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
            source: 'geo-lock:refresh', accountId: 'alice', clientId: 'spa', failure: 'geo_lock_country:SE',
        }))
        const logged = globalThis.logger.info.mock.calls.map(([fields]) => fields)
        expect(logged).toContainEqual(expect.objectContaining({pinnedCountry: 'GB', country: 'SE', failure: 'geo_lock_country'}))
        expect(logged).toContainEqual(expect.objectContaining({logType: 'audit', audit: expect.objectContaining({event: 'session.geo.denied'})}))
    })

    it('accepts an allowlisted country', async () => {
        vi.stubEnv('GEO_LOCK_ALLOWED_COUNTRIES', 'SE')
        await expect(enforceGeoLock(ctx(SE), {source: 'site-session', pinnedCountry: 'GB'})).resolves.toBeNull()
    })

    it('is inert while geo-lock is off', async () => {
        vi.stubEnv('GEO_LOCK_ENABLED', 'false')
        await expect(enforceGeoLock(ctx(SE), {source: 'site-session', pinnedCountry: undefined})).resolves.toBeNull()
    })
})
