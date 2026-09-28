import {afterEach, describe, expect, it, vi} from 'vitest'
import {resolveIdpDisplayName} from '../../src/utils/idp-display-name.js'
import OIDCClient from '../../src/models/oidc-client.js'

afterEach(() => vi.unstubAllEnvs())

const google = () => {
    vi.stubEnv('OIDC_PROVIDERS', JSON.stringify({google: {displayName: 'Google', issuer: 'https://accounts.google.com'}}))
    vi.stubEnv('GOOGLE_CLIENT_ID', 'id')
    vi.stubEnv('GOOGLE_CLIENT_SECRET', 'secret')
}

describe('resolveIdpDisplayName', () => {
    it('names GitHub when it is the only upstream', () => {
        vi.stubEnv('GITHUB_ENABLED', 'true')
        vi.stubEnv('OUTBOUND_EMAIL_ENABLED', 'false')
        vi.stubEnv('OIDC_PROVIDERS', '')
        expect(resolveIdpDisplayName()).toBe('GitHub')
    })

    it('names a lone generic provider by its displayName', () => {
        vi.stubEnv('GITHUB_ENABLED', 'false')
        vi.stubEnv('OUTBOUND_EMAIL_ENABLED', 'false')
        google()
        expect(resolveIdpDisplayName()).toBe('Google')
    })

    it('ignores passkeys when counting upstreams', () => {
        vi.stubEnv('GITHUB_ENABLED', 'true')
        vi.stubEnv('WEBAUTHN_ENABLED', 'true')
        vi.stubEnv('OUTBOUND_EMAIL_ENABLED', 'false')
        vi.stubEnv('OIDC_PROVIDERS', '')
        expect(resolveIdpDisplayName()).toBe('GitHub')
    })

    it('falls back to Passmower with several upstreams', () => {
        vi.stubEnv('GITHUB_ENABLED', 'true')
        vi.stubEnv('OUTBOUND_EMAIL_ENABLED', 'false')
        google()
        expect(resolveIdpDisplayName()).toBe('Passmower')
    })

    it('falls back to Passmower when magic-link email sits beside the upstream', () => {
        vi.stubEnv('GITHUB_ENABLED', 'true')
        vi.stubEnv('OUTBOUND_EMAIL_ENABLED', 'true')
        vi.stubEnv('OIDC_PROVIDERS', '')
        expect(resolveIdpDisplayName()).toBe('Passmower')
    })

    it('falls back to Passmower with no upstream at all', () => {
        vi.stubEnv('GITHUB_ENABLED', 'false')
        vi.stubEnv('OUTBOUND_EMAIL_ENABLED', 'true')
        vi.stubEnv('OIDC_PROVIDERS', '')
        expect(resolveIdpDisplayName()).toBe('Passmower')
    })

    it('prefers the explicit override over any resolution', () => {
        vi.stubEnv('GITHUB_ENABLED', 'true')
        vi.stubEnv('OUTBOUND_EMAIL_ENABLED', 'false')
        vi.stubEnv('IDP_DISPLAY_NAME', '  Example Corp  ')
        expect(resolveIdpDisplayName()).toBe('Example Corp')
    })

    it('treats a blank override as unset', () => {
        vi.stubEnv('GITHUB_ENABLED', 'true')
        vi.stubEnv('OUTBOUND_EMAIL_ENABLED', 'false')
        vi.stubEnv('OIDC_PROVIDERS', '')
        vi.stubEnv('IDP_DISPLAY_NAME', ' ')
        expect(resolveIdpDisplayName()).toBe('GitHub')
    })
})

describe('OIDC_IDP_DISPLAY_NAME in the generated client Secret', () => {
    it('carries the resolved name', () => {
        vi.stubEnv('IDP_DISPLAY_NAME', 'Example Corp')
        const client = new OIDCClient().fromIncomingClient({
            metadata: {name: 'grafana', namespace: 'apps', resourceVersion: '1', uid: 'uid-1', annotations: {}},
            spec: {grantTypes: ['authorization_code'], responseTypes: ['code'], redirectUris: ['https://grafana.example.com/login/generic_oauth'], availableScopes: ['openid']},
            status: {},
        })
        expect(client.toClientSecret({urlFor: route => `https://oidc.example/${route}`}))
            .toMatchObject({OIDC_IDP_DISPLAY_NAME: 'Example Corp'})
    })
})
