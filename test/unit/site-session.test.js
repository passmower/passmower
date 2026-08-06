import {describe, expect, it, vi} from 'vitest'

const mocks = vi.hoisted(() => ({
    upsert: vi.fn(),
    providerConfiguration: {
        cookies: {long: {httpOnly: true, secure: true}},
        ttl: {SiteSession: 3600},
    },
}))

vi.mock('../../src/adapters/redis.js', () => ({
    default: class RedisAdapter {
        upsert(...args) {
            return mocks.upsert(...args)
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
