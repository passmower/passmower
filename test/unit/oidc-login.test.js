import {describe, expect, it} from 'vitest'
import {extractIdentity, getOidcEmailError, mergeOidcProfile, shouldOverrideUnverifiedEmail} from '../../src/services/login/oidc-login.js'

const provider = {groupsClaim: null, linkingClaims: [], emailVerification: 'oidc-claim'}

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

        const identity = extractIdentity(provider, profile, '2026-08-22T10:00:00.000Z')

        expect(identity.emails).toEqual([{
            email: 'Person@Example.COM', primary: true, verified: expected,
            observedAt: '2026-08-22T10:00:00.000Z',
        }])
    })

    it.each([
        ['google', 'oidc-claim', true, true],
        ['gitlab', 'oidc-claim', false, false],
        ['dex', 'oidc-claim', undefined, undefined],
        ['entra', 'none', true, undefined],
        ['codeberg', 'none', true, undefined],
        ['forgejo', 'none', true, undefined],
        ['unknown', 'none', true, undefined],
    ])('%s maps only explicitly trusted verification signals', (_name, capability, signal, expected) => {
        const profile = {sub: 'subject', email: 'person@example.com'}
        if (signal !== undefined) profile.email_verified = signal
        const identity = extractIdentity({...provider, emailVerification: capability}, profile, '2026-08-22T10:00:00.000Z')
        expect(identity.emails[0].verified).toBe(expected)
    })

    it('does not transfer ID-token verification when UserInfo changes the email', () => {
        expect(mergeOidcProfile(
            {email: 'old@example.com', email_verified: true},
            {email: 'new@example.com'},
        )).toEqual({email: 'new@example.com'})
    })

    it('overrides an upstream-unverified email only for an already-linked, Passmower-verified identity', async () => {
        const flag = {PASSMOWER_VERIFIED_EMAIL_OVERRIDE: 'true'}
        const ctx = (account) => ({kubeOIDCUserService: {findUserByIdentity: async () => account}})
        const linked = (evidence) => ({getEmailVerifications: () => evidence})
        const magicLink = [{email: 'person@example.com', method: 'magic-link', status: 'verified'}]

        await expect(shouldOverrideUnverifiedEmail(ctx(linked(magicLink)), 'dex', 'sub', 'Person@EXAMPLE.com', flag))
            .resolves.toBe(true)
        // flag off
        await expect(shouldOverrideUnverifiedEmail(ctx(linked(magicLink)), 'dex', 'sub', 'person@example.com', {}))
            .resolves.toBe(false)
        // first login: identity not linked to any account yet
        await expect(shouldOverrideUnverifiedEmail(ctx(undefined), 'dex', 'sub', 'person@example.com', flag))
            .resolves.toBe(false)
        // provider evidence alone is not Passmower verification
        await expect(shouldOverrideUnverifiedEmail(
            ctx(linked([{email: 'person@example.com', method: 'oidc-claim', status: 'verified'}])),
            'dex', 'sub', 'person@example.com', flag)).resolves.toBe(false)
        // evidence covers a different address
        await expect(shouldOverrideUnverifiedEmail(
            ctx(linked([{email: 'other@example.com', method: 'magic-link', status: 'verified'}])),
            'dex', 'sub', 'person@example.com', flag)).resolves.toBe(false)
        // identity conflicts fail closed
        const conflicted = {kubeOIDCUserService: {findUserByIdentity: async () => { throw new Error('conflict') }}}
        await expect(shouldOverrideUnverifiedEmail(conflicted, 'dex', 'sub', 'person@example.com', flag))
            .resolves.toBe(false)
    })

    it('uses exact-address evidence from either response and fails closed on conflict', () => {
        expect(mergeOidcProfile(
            {email: 'Person@example.com', email_verified: true},
            {email: 'person@EXAMPLE.com'},
        ).email_verified).toBe(true)
        expect(mergeOidcProfile(
            {email: 'person@example.com', email_verified: true},
            {email: 'person@example.com', email_verified: false},
        ).email_verified).toBe(false)
    })
})
