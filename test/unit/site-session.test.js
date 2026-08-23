import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'

const mocks = vi.hoisted(() => ({
    upsert: vi.fn(),
    find: vi.fn(),
    destroy: vi.fn(),
    providerConfiguration: {
        cookies: {long: {httpOnly: true, secure: true}},
        ttl: {SiteSession: 3600},
    },
}))

vi.mock('../../src/adapters/redis.js', () => ({
    default: class RedisAdapter {
        constructor(name) {
            this.name = name
        }
        upsert(...args) {
            return mocks.upsert(...args)
        }
        find(...args) {
            return mocks.find(this.name, ...args)
        }
        destroy(...args) {
            return mocks.destroy(this.name, ...args)
        }
    },
}))

vi.mock('oidc-provider/lib/helpers/weak_cache.js', () => ({
    default: () => ({configuration: mocks.providerConfiguration}),
}))

vi.mock('oidc-provider/lib/helpers/nanoid.js', () => ({
    default: () => 'new-site-session-jti',
}))

import {
    addSiteSession,
    getLegacySiteSessionCookieDomain,
    getSiteSessionCookieDomain,
    siteSessionIpMismatch,
    validateSiteSession,
} from '../../src/utils/session/site-session.js'
import {providerBaseDomain} from '../../src/utils/session/base-domain.js'

describe('site session cookie scope', () => {
    it('uses a host-only cookie for the Passmower dashboard', () => {
        expect(getSiteSessionCookieDomain('passmower')).toBeUndefined()
    })

    it('uses the provider base domain for forward-auth clients', () => {
        expect(getSiteSessionCookieDomain('apps.webmail')).toBe(providerBaseDomain)
    })

    it('expires a legacy domain cookie before setting the host-only dashboard cookie', async () => {
        const set = vi.fn()

        await addSiteSession(
            {cookies: {set}},
            {},
            'session-id',
            'account-id',
            {clientId: 'passmower'},
        )

        expect(getLegacySiteSessionCookieDomain('passmower')).toBe(providerBaseDomain)
        expect(set).toHaveBeenNthCalledWith(1, '_site_session.passmower', null, {
            httpOnly: true,
            secure: true,
            domain: providerBaseDomain,
        })
        expect(set).toHaveBeenNthCalledWith(2, '_site_session.passmower', expect.any(String), {
            httpOnly: true,
            secure: true,
            maxAge: 3600000,
        })
    })
})

describe('site session IP binding', () => {
    const clientId = 'apps.webmail'
    const record = (ip) => ({
        jti: 'jti-1', sessionId: 'sess-1', accountId: 'acc',
        domain: providerBaseDomain,
        ...(ip ? {ip} : {}),
    })
    const ctx = (ip) => ({cookies: {get: () => 'jti-1'}, headers: {'x-forwarded-for': ip}})

    const stubStores = (siteSession) => {
        mocks.find.mockImplementation(async (name, id) => {
            if (name === 'SiteSession' && id === 'jti-1') return siteSession
            if (name === 'Session' && id === 'sess-1') return {authorizations: {[clientId]: {grantId: 'g'}}}
            return undefined
        })
    }

    beforeEach(() => {
        globalThis.logger = {info: vi.fn(), error: vi.fn(), warn: vi.fn()}
        mocks.find.mockReset()
        mocks.destroy.mockReset()
    })

    afterEach(() => {
        vi.unstubAllEnvs()
    })

    it('is inert unless SITE_SESSION_IP_BINDING is enabled', () => {
        expect(siteSessionIpMismatch(record('1.1.1.1'), '2.2.2.2', {})).toBe(false)
        expect(siteSessionIpMismatch(record('1.1.1.1'), '2.2.2.2', {SITE_SESSION_IP_BINDING: 'true'})).toBe(true)
        expect(siteSessionIpMismatch(record('1.1.1.1'), '1.1.1.1', {SITE_SESSION_IP_BINDING: 'true'})).toBe(false)
        // records issued before the flag was enabled carry no ip and fail closed
        expect(siteSessionIpMismatch(record(undefined), '1.1.1.1', {SITE_SESSION_IP_BINDING: 'true'})).toBe(true)
    })

    it('stamps the issuing address on new site sessions', async () => {
        await addSiteSession(
            {cookies: {set: vi.fn()}, headers: {'x-forwarded-for': '1.1.1.1, 10.0.0.1'}},
            {},
            'session-id',
            'account-id',
            {clientId},
        )
        expect(mocks.upsert).toHaveBeenCalledWith(
            'new-site-session-jti',
            expect.objectContaining({ip: '1.1.1.1'}),
            3600,
        )
    })

    it('accepts a session presented from its issuing address', async () => {
        vi.stubEnv('SITE_SESSION_IP_BINDING', 'true')
        stubStores(record('1.1.1.1'))
        await expect(validateSiteSession(ctx('1.1.1.1'), clientId))
            .resolves.toMatchObject({jti: 'jti-1', ip: '1.1.1.1'})
        expect(mocks.destroy).not.toHaveBeenCalled()
    })

    it('destroys a session presented from a different address', async () => {
        vi.stubEnv('SITE_SESSION_IP_BINDING', 'true')
        stubStores(record('1.1.1.1'))
        await expect(validateSiteSession(ctx('2.2.2.2'), clientId)).resolves.toBeUndefined()
        expect(mocks.destroy).toHaveBeenCalledWith('SiteSession', 'jti-1')
    })

    it('keeps prior behavior while the flag is off', async () => {
        stubStores(record('1.1.1.1'))
        await expect(validateSiteSession(ctx('2.2.2.2'), clientId))
            .resolves.toMatchObject({jti: 'jti-1'})
        expect(mocks.destroy).not.toHaveBeenCalled()
    })
})
