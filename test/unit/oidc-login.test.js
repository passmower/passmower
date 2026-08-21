import {describe, expect, it} from 'vitest'
import {extractIdentity, getOidcEmailError} from '../../src/services/login/oidc-login.js'

const provider = {groupsClaim: null, linkingClaims: []}

describe('generic OIDC email verification evidence', () => {
    it('requires email only while email support is enabled', () => {
        expect(getOidcEmailError({sub: 'subject'}, {EMAIL_ENABLED: 'true'})).toBe('missing')
        expect(getOidcEmailError({sub: 'subject'}, {EMAIL_ENABLED: 'false'})).toBeNull()
        expect(getOidcEmailError(
            {sub: 'subject', email: 'a@example.com', email_verified: false},
            {EMAIL_ENABLED: 'false'},
        )).toBe('unverified')
    })

    it('represents an email-less stable identity without an invalid email entry', () => {
        expect(extractIdentity(provider, {sub: 'subject', name: 'Email Free'})).toMatchObject({
            sub: 'subject', primaryEmail: undefined, emails: [], name: 'Email Free',
        })
    })

    it.each([
        [true, true],
        [false, false],
        [undefined, undefined],
    ])('maps email_verified=%s without inferring missing evidence', (emailVerified, expected) => {
        const profile = {sub: 'subject', email: 'Person@Example.COM'}
        if (emailVerified !== undefined) profile.email_verified = emailVerified

        const identity = extractIdentity(provider, profile)

        expect(identity.emails).toEqual([{
            email: 'Person@Example.COM', primary: true, verified: expected,
        }])
    })
})
