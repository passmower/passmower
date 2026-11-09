import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'
import {fileURLToPath} from 'node:url'
import {
    allowedCountries,
    attributionFor,
    countryOf,
    GEO_LOCK_COUNTRY,
    GEO_LOCK_UNPINNED,
    geoLockFailure,
    geoOf,
    resetGeoipReader,
    UNKNOWN_COUNTRY,
    validateGeoipConfiguration,
} from '../../src/utils/geoip.js'

// MaxMind's MIT-licensed GeoIP2-Country test database (test/fixtures/geoip).
const GEOIP_FIXTURE = fileURLToPath(new URL('../fixtures/geoip/GeoIP2-Country-Test.mmdb', import.meta.url))
const GB = '81.2.69.142'
const SE = '89.160.20.112'

describe('geoip lookup', () => {
    beforeEach(() => resetGeoipReader())
    afterEach(() => resetGeoipReader())

    const env = {GEOIP_DATABASE_PATH: GEOIP_FIXTURE}

    it('resolves the country of an address', async () => {
        await expect(countryOf(GB, env)).resolves.toBe('GB')
        await expect(countryOf(SE, env)).resolves.toBe('SE')
    })

    it('places private, missing and malformed addresses in ZZ', async () => {
        await expect(countryOf('10.0.0.1', env)).resolves.toBe(UNKNOWN_COUNTRY)
        await expect(countryOf(undefined, env)).resolves.toBe(UNKNOWN_COUNTRY)
        await expect(countryOf('not-an-ip', env)).resolves.toBe(UNKNOWN_COUNTRY)
    })

    it('resolves nothing without a database', async () => {
        const missing = {GEOIP_DATABASE_PATH: '/nonexistent/geoip.mmdb'}
        await expect(countryOf(GB, missing)).resolves.toBeUndefined()
        await expect(geoOf(GB, missing)).resolves.toBeUndefined()
    })

    it('fails boot when geo-lock is on without a database', async () => {
        await expect(validateGeoipConfiguration({GEO_LOCK_ENABLED: 'true', GEOIP_DATABASE_PATH: '/nonexistent/geoip.mmdb'}))
            .rejects.toThrow(/GEOIP_DATABASE_PATH/)
        resetGeoipReader()
        await expect(validateGeoipConfiguration({GEO_LOCK_ENABLED: 'true', ...env})).resolves.toBeUndefined()
        await expect(validateGeoipConfiguration({})).resolves.toBeUndefined()
    })

    it('names the attribution the free databases require', () => {
        expect(attributionFor('DBIP-Country-Lite')).toMatchObject({url: 'https://db-ip.com'})
        expect(attributionFor('GeoLite2-Country')).toMatchObject({url: 'https://www.maxmind.com'})
        expect(attributionFor('GeoIP2-Country')).toBeUndefined()
    })
})

describe('geo-lock policy', () => {
    it('parses the allowlist', () => {
        expect(allowedCountries({GEO_LOCK_ALLOWED_COUNTRIES: ' ee, fi ,,'})).toEqual(['EE', 'FI'])
        expect(allowedCountries({})).toEqual([])
    })

    it('accepts the pinned country and allowlisted countries only', () => {
        const env = {GEO_LOCK_ALLOWED_COUNTRIES: 'FI'}
        expect(geoLockFailure('EE', 'EE', env)).toBeNull()
        expect(geoLockFailure('EE', 'FI', env)).toBeNull()
        expect(geoLockFailure('EE', 'SE', env)).toBe(GEO_LOCK_COUNTRY)
        expect(geoLockFailure('EE', UNKNOWN_COUNTRY, env)).toBe(GEO_LOCK_COUNTRY)
        expect(geoLockFailure(UNKNOWN_COUNTRY, UNKNOWN_COUNTRY, env)).toBeNull()
    })

    it('fails closed for a session without a pin', () => {
        expect(geoLockFailure(undefined, 'EE', {GEO_LOCK_ALLOWED_COUNTRIES: 'EE'})).toBe(GEO_LOCK_UNPINNED)
    })
})

describe('geo-lock reader seam', () => {
    it('does not open the database at import', async () => {
        const open = vi.fn()
        vi.resetModules()
        vi.doMock('maxmind', () => ({default: {open, validate: () => true}}))
        await import('../../src/utils/geoip.js')
        expect(open).not.toHaveBeenCalled()
        vi.doUnmock('maxmind')
        vi.resetModules()
    })
})
