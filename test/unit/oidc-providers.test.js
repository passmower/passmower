import { describe, it, expect, vi, afterEach } from 'vitest'
import { getOidcProviders, getOidcProvider, oidcRedirectUri } from '../../src/utils/oidc-providers.js'

afterEach(() => vi.unstubAllEnvs())

describe('getOidcProviders', () => {
    it('returns [] when OIDC_PROVIDERS is unset or invalid JSON', () => {
        vi.stubEnv('OIDC_PROVIDERS', '')
        expect(getOidcProviders()).toEqual([])
        vi.stubEnv('OIDC_PROVIDERS', 'not json')
        expect(getOidcProviders()).toEqual([])
    })

    it('surfaces a provider only when both client id and secret are present', () => {
        vi.stubEnv('OIDC_PROVIDERS', JSON.stringify([{ key: 'google', issuer: 'https://accounts.google.com' }]))
        // No creds yet -> not enabled -> filtered out
        expect(getOidcProviders()).toEqual([])

        vi.stubEnv('GOOGLE_CLIENT_ID', 'id')
        vi.stubEnv('GOOGLE_CLIENT_SECRET', 'secret')
        const providers = getOidcProviders()
        expect(providers).toHaveLength(1)
        expect(providers[0]).toMatchObject({
            key: 'google',
            displayName: 'google',
            clientId: 'id',
            clientSecret: 'secret',
            enabled: true,
        })
    })

    it('defaults groupPrefix to the issuer host and scopes to openid/email/profile', () => {
        vi.stubEnv('OIDC_PROVIDERS', JSON.stringify([{ key: 'gitlab', issuer: 'https://gitlab.example.com' }]))
        vi.stubEnv('GITLAB_CLIENT_ID', 'id')
        vi.stubEnv('GITLAB_CLIENT_SECRET', 'secret')
        const [p] = getOidcProviders()
        expect(p.groupPrefix).toBe('gitlab.example.com')
        expect(p.scopes).toEqual(['openid', 'email', 'profile'])
    })

    it('maps a provider key with non-alphanumerics to an underscored env prefix', () => {
        vi.stubEnv('OIDC_PROVIDERS', JSON.stringify([{ key: 'entra-id', issuer: 'https://login.microsoftonline.com' }]))
        vi.stubEnv('ENTRA_ID_CLIENT_ID', 'id')
        vi.stubEnv('ENTRA_ID_CLIENT_SECRET', 'secret')
        expect(getOidcProvider('entra-id')).toMatchObject({ key: 'entra-id', enabled: true })
    })
})

describe('oidcRedirectUri', () => {
    it('builds the upstream callback URL under ISSUER_URL', () => {
        vi.stubEnv('ISSUER_URL', 'https://oidc.test/')
        expect(oidcRedirectUri('google')).toBe('https://oidc.test/interaction/callback/google')
    })
})
