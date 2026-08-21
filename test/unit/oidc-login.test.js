import {describe, expect, it} from 'vitest'
import {extractIdentity} from '../../src/services/login/oidc-login.js'

const provider = {groupsClaim: null, linkingClaims: []}

describe('generic OIDC email verification evidence', () => {
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
