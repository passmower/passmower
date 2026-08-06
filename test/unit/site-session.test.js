import {describe, expect, it} from 'vitest'
import {getSiteSessionCookieDomain} from '../../src/utils/session/site-session.js'
import {providerBaseDomain} from '../../src/utils/session/base-domain.js'

describe('site session cookie scope', () => {
    it('uses a host-only cookie for the Passmower dashboard', () => {
        expect(getSiteSessionCookieDomain('passmower')).toBeUndefined()
    })

    it('uses the provider base domain for forward-auth clients', () => {
        expect(getSiteSessionCookieDomain('apps.webmail')).toBe(providerBaseDomain)
    })
})
