import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'
import {fileURLToPath} from 'node:url'

const mocks = vi.hoisted(() => ({store: new Map()}))

vi.mock('../../src/adapters/redis.js', () => ({
    default: class RedisAdapter {
        constructor(name) {
            this.name = name
        }
        async getFields(id) {
            return mocks.store.get(`${this.name}:${id}`) ?? {}
        }
        async setExpiringField(id, field, exp, now = Math.floor(Date.now() / 1000)) {
            const fields = mocks.store.get(`${this.name}:${id}`) ?? {}
            const existed = Number(fields[field]) > now
            mocks.store.set(`${this.name}:${id}`, {...fields, [field]: String(exp)})
            return existed
        }
    },
}))

import {
    gateAsns,
    gateDecision,
    sessionUnlocked,
    unlockAddress,
    validateAddressGateConfiguration,
} from '../../src/services/address-gate.js'
import {resetGeoipReader} from '../../src/utils/geoip.js'
import {addressKey, inRanges, normalizeIp, parseRanges} from '../../src/utils/ip-address.js'

const fixture = (name) => fileURLToPath(new URL(`../fixtures/geoip/${name}`, import.meta.url))
const GB = '81.2.69.142'      // country GB, no ASN record
const SE = '89.160.20.112'    // country SE, AS29518 Bredband2
const TELSTRA = '1.128.0.1'   // AS1221 Telstra
const now = () => Math.floor(Date.now() / 1000)

describe('address helpers', () => {
    it('keys IPv4 by address and IPv6 by its /64', () => {
        expect(addressKey('192.0.2.1')).toBe('192.0.2.1')
        expect(addressKey('::ffff:192.0.2.1')).toBe('192.0.2.1')
        expect(addressKey('2001:db8:1:2:aaaa::1')).toBe('2001:0db8:0001:0002::/64')
        expect(addressKey('2001:db8:1:2:bbbb::9')).toBe(addressKey('2001:db8:1:2:aaaa::1'))
        expect(addressKey('not-an-address')).toBeUndefined()
        expect(normalizeIp(' 2001:DB8::1 ')).toBe('2001:db8::1')
    })

    it('matches ranges, including ones written with host bits set', () => {
        const ranges = parseRanges('172.28.0.0/16 193.40.103.250/24, 2001:db8::/32 198.51.100.7')
        expect(inRanges(ranges, '172.28.9.9')).toBe(true)
        expect(inRanges(ranges, '193.40.103.1')).toBe(true)
        expect(inRanges(ranges, '193.40.104.1')).toBe(false)
        expect(inRanges(ranges, '2001:db8:ffff::1')).toBe(true)
        expect(inRanges(ranges, '198.51.100.7')).toBe(true)
        expect(inRanges(ranges, '198.51.100.8')).toBe(false)
        expect(inRanges(parseRanges(''), '172.28.9.9')).toBe(false)
    })

    it('refuses a malformed range', () => {
        expect(() => parseRanges('10.0.0.0/33')).toThrow(/10.0.0.0\/33/)
        expect(() => parseRanges('example.com')).toThrow(/example.com/)
        // An empty prefix is not /0: it must never widen to every address.
        for (const entry of ['192.0.2.5/', '192.0.2.0/24/8', '192.0.2.0/-1', '192.0.2.0/2.5', '192.0.2.0/ 8', '/24', '2001:db8::/', '2001:db8::/129', '192.0.2.0/0x8']) {
            expect(() => parseRanges(entry), entry).toThrow(/Invalid address range/)
        }
        expect(inRanges(parseRanges('0.0.0.0/0'), '203.0.113.9')).toBe(true)
    })
})

describe('address gate', () => {
    const noSessions = vi.fn()

    beforeEach(() => {
        resetGeoipReader()
        mocks.store.clear()
        noSessions.mockReset()
        vi.stubEnv('GEOIP_DATABASE_PATH', fixture('GeoIP2-Country-Test.mmdb'))
        vi.stubEnv('GEOIP_ASN_DATABASE_PATH', fixture('GeoLite2-ASN-Test.mmdb'))
        vi.stubEnv('ADDRESS_GATE_ENABLED', 'true')
        vi.stubEnv('ADDRESS_GATE_ALLOWED_RANGES', '10.0.0.0/8')
        vi.stubEnv('ADDRESS_GATE_ALLOWED_COUNTRIES', 'se')
        vi.stubEnv('ADDRESS_GATE_ALLOWED_ASNS', 'AS1221')
    })

    afterEach(() => {
        vi.unstubAllEnvs()
        resetGeoipReader()
    })

    const decide = (ip) => gateDecision(ip, {findSessionByUid: noSessions})

    it('allows by range, country and ASN, cheapest rule first', async () => {
        await expect(decide('10.1.2.3')).resolves.toEqual({allowed: true, rule: 'range'})
        await expect(decide(SE)).resolves.toEqual({allowed: true, rule: 'country'})
        await expect(decide(TELSTRA)).resolves.toEqual({allowed: true, rule: 'asn'})
        expect(noSessions).not.toHaveBeenCalled()
    })

    it('refuses everything else, naming what it saw', async () => {
        await expect(decide(GB)).resolves.toMatchObject({allowed: false, rule: 'none', country: 'GB'})
        await expect(decide(undefined)).resolves.toMatchObject({allowed: false})
    })

    it('parses ASNs with or without the AS prefix', () => {
        expect(gateAsns({ADDRESS_GATE_ALLOWED_ASNS: 'AS3249, 2586 as8240'})).toEqual([3249, 2586, 8240])
        expect(() => gateAsns({ADDRESS_GATE_ALLOWED_ASNS: 'Telia'})).toThrow(/Telia/)
    })

    it('lets an address through while a session that unlocked it is alive', async () => {
        await unlockAddress(GB, {uid: 's1', exp: now() + 600}, 60)
        noSessions.mockResolvedValue({accountId: 'alice'})
        await expect(decide(GB)).resolves.toEqual({allowed: true, rule: 'session'})
        expect(noSessions).toHaveBeenCalledWith('s1')
    })

    it('closes the address once the session is gone', async () => {
        await unlockAddress(GB, {uid: 's1', exp: now() + 600}, 60)
        noSessions.mockResolvedValue(undefined)
        await expect(sessionUnlocked(GB, noSessions)).resolves.toBe(false)
    })

    it('keeps every session sharing an address', async () => {
        await unlockAddress(GB, {uid: 's1', exp: now() + 600}, 60)
        await unlockAddress(GB, {uid: 's2', exp: now() + 1200}, 60)
        // s1 signed out; s2 still holds the address open.
        noSessions.mockImplementation(async (uid) => uid === 's2' ? {accountId: 'bob'} : undefined)
        await expect(sessionUnlocked(GB, noSessions)).resolves.toBe(true)
    })

    it('reports a repeated unlock by the same session', async () => {
        const session = {uid: 's1', exp: now() + 600}
        await expect(unlockAddress(GB, session, 60)).resolves.toEqual({key: GB, already: false})
        await expect(unlockAddress(GB, session, 60)).resolves.toEqual({key: GB, already: true})
        await expect(unlockAddress('junk', session, 60)).resolves.toEqual({})
    })

    it('ignores session unlocks when they are switched off', async () => {
        vi.stubEnv('ADDRESS_GATE_SESSION_UNLOCK', 'false')
        await unlockAddress(GB, {uid: 's1', exp: now() + 600}, 60)
        noSessions.mockResolvedValue({accountId: 'alice'})
        await expect(decide(GB)).resolves.toMatchObject({allowed: false})
    })

    it('fails boot on rules it cannot evaluate', async () => {
        resetGeoipReader()
        await expect(validateAddressGateConfiguration({
            ADDRESS_GATE_ENABLED: 'true', ADDRESS_GATE_ALLOWED_COUNTRIES: 'EE', GEOIP_DATABASE_PATH: '/nonexistent.mmdb',
        })).rejects.toThrow(/GEOIP_DATABASE_PATH/)
        await expect(validateAddressGateConfiguration({
            ADDRESS_GATE_ENABLED: 'true', ADDRESS_GATE_ALLOWED_ASNS: '3249', GEOIP_ASN_DATABASE_PATH: '/nonexistent.mmdb',
        })).rejects.toThrow(/GEOIP_ASN_DATABASE_PATH/)
        await expect(validateAddressGateConfiguration({
            ADDRESS_GATE_ENABLED: 'true', ADDRESS_GATE_ALLOWED_RANGES: '10.0.0.0/40',
        })).rejects.toThrow(/10.0.0.0\/40/)
        await expect(validateAddressGateConfiguration({ADDRESS_GATE_ALLOWED_RANGES: 'junk'})).resolves.toBeUndefined()
    })
})
