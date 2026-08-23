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
        vi.stubEnv('OIDC_PROVIDERS', JSON.stringify({ google: { issuer: 'https://accounts.google.com' } }))
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
        vi.stubEnv('EMAIL_ENABLED', 'true')
        vi.stubEnv('OIDC_PROVIDERS', JSON.stringify({ gitlab: { issuer: 'https://gitlab.example.com' } }))
        vi.stubEnv('GITLAB_CLIENT_ID', 'id')
        vi.stubEnv('GITLAB_CLIENT_SECRET', 'secret')
        const [p] = getOidcProviders()
        expect(p.groupPrefix).toBe('gitlab.example.com')
        expect(p.scopes).toEqual(['openid', 'email', 'profile'])
        expect(p.emailVerification).toBe('none')
    })

    it('only auto-trusts audited issuers and allows an explicit override', () => {
        vi.stubEnv('OIDC_PROVIDERS', JSON.stringify({
            google: {issuer: 'https://accounts.google.com'},
            gitlab: {issuer: 'https://gitlab.com', emailVerification: 'none'},
            dex: {issuer: 'https://dex.example.com', emailVerification: 'oidc-claim'},
            unknown: {issuer: 'https://unknown.example.com'},
        }))
        for (const key of ['google', 'gitlab', 'dex', 'unknown']) {
            vi.stubEnv(`${key.toUpperCase()}_CLIENT_ID`, 'id')
            vi.stubEnv(`${key.toUpperCase()}_CLIENT_SECRET`, 'secret')
        }

        expect(Object.fromEntries(getOidcProviders().map(p => [p.key, p.emailVerification]))).toEqual({
            dex: 'oidc-claim', gitlab: 'none', google: 'oidc-claim', unknown: 'none',
        })
    })

    it('requests email by default even when delivery is disabled, preserving explicit scopes', () => {
        vi.stubEnv('EMAIL_ENABLED', 'false')
        vi.stubEnv('GITLAB_CLIENT_ID', 'id')
        vi.stubEnv('GITLAB_CLIENT_SECRET', 'secret')
        vi.stubEnv('OIDC_PROVIDERS', JSON.stringify({gitlab: {issuer: 'https://gitlab.example.com'}}))
        expect(getOidcProvider('gitlab').scopes).toEqual(['openid', 'email', 'profile'])

        vi.stubEnv('OIDC_PROVIDERS', JSON.stringify({
            gitlab: {issuer: 'https://gitlab.example.com', scopes: ['openid', 'email']},
        }))
        expect(getOidcProvider('gitlab').scopes).toEqual(['openid', 'email'])
    })

    it('defaults tokenEndpointAuthMethod to client_secret_post and only allows basic as the alternative', () => {
        vi.stubEnv('GOOGLE_CLIENT_ID', 'id')
        vi.stubEnv('GOOGLE_CLIENT_SECRET', 'secret')

        vi.stubEnv('OIDC_PROVIDERS', JSON.stringify({ google: { issuer: 'https://accounts.google.com' } }))
        expect(getOidcProvider('google').tokenEndpointAuthMethod).toBe('client_secret_post')

        vi.stubEnv('OIDC_PROVIDERS', JSON.stringify({ google: { issuer: 'https://accounts.google.com', tokenEndpointAuthMethod: 'client_secret_basic' } }))
        expect(getOidcProvider('google').tokenEndpointAuthMethod).toBe('client_secret_basic')

        // Anything unrecognized falls back to the safe default.
        vi.stubEnv('OIDC_PROVIDERS', JSON.stringify({ google: { issuer: 'https://accounts.google.com', tokenEndpointAuthMethod: 'private_key_jwt' } }))
        expect(getOidcProvider('google').tokenEndpointAuthMethod).toBe('client_secret_post')
    })

    it('maps a provider key with non-alphanumerics to an underscored env prefix', () => {
        vi.stubEnv('OIDC_PROVIDERS', JSON.stringify({ 'entra-id': { issuer: 'https://login.microsoftonline.com' } }))
        vi.stubEnv('ENTRA_ID_CLIENT_ID', 'id')
        vi.stubEnv('ENTRA_ID_CLIENT_SECRET', 'secret')
        expect(getOidcProvider('entra-id')).toMatchObject({ key: 'entra-id', enabled: true })
    })

    it('sorts providers by order and then provider key', () => {
        vi.stubEnv('OIDC_PROVIDERS', JSON.stringify({
            unordered: { issuer: 'https://unordered.example.com' },
            second: { issuer: 'https://second.example.com', order: 20 },
            alpha: { issuer: 'https://alpha.example.com', order: 10 },
            beta: { issuer: 'https://beta.example.com', order: 10 },
        }))
        for (const key of ['unordered', 'second', 'alpha', 'beta']) {
            vi.stubEnv(`${key.toUpperCase()}_CLIENT_ID`, 'id')
            vi.stubEnv(`${key.toUpperCase()}_CLIENT_SECRET`, 'secret')
        }

        expect(getOidcProviders().map(provider => provider.key)).toEqual([
            'alpha', 'beta', 'second', 'unordered'
        ])
    })

    it('rejects the legacy provider list shape', () => {
        vi.stubEnv('OIDC_PROVIDERS', JSON.stringify([
            { key: 'google', issuer: 'https://accounts.google.com' }
        ]))
        vi.stubEnv('GOOGLE_CLIENT_ID', 'id')
        vi.stubEnv('GOOGLE_CLIENT_SECRET', 'secret')

        expect(getOidcProviders()).toEqual([])
    })

    it('retains only valid configured linking claim names', () => {
        vi.stubEnv('OIDC_PROVIDERS', JSON.stringify({
            entra: {
                issuer: 'https://login.microsoftonline.com/common/v2.0',
                linkingClaims: ['tid', 'oid', 'tid', 'bad claim'],
            }
        }))
        vi.stubEnv('ENTRA_CLIENT_ID', 'id')
        vi.stubEnv('ENTRA_CLIENT_SECRET', 'secret')
        expect(getOidcProvider('entra').linkingClaims).toEqual(['tid', 'oid'])
    })
})

describe('oidcRedirectUri', () => {
    it('builds the upstream callback URL under ISSUER_URL', () => {
        vi.stubEnv('ISSUER_URL', 'https://oidc.test/')
        expect(oidcRedirectUri('google')).toBe('https://oidc.test/interaction/callback/google')
    })
})
