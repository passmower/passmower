import { describe, it, expect } from 'vitest'
import OIDCClient from '../../src/models/oidc-client.js'

// Minimal OIDCClient custom resource as the operator would receive it.
function incomingClient(spec = {}) {
    return {
        metadata: { name: 'my-app', namespace: 'apps', resourceVersion: '1', uid: 'uid-1', annotations: {} },
        spec: {
            grantTypes: ['authorization_code'],
            responseTypes: ['code'],
            redirectUris: ['https://app.example.com/callback'],
            availableScopes: ['openid'],
            ...spec,
        },
        status: {},
    }
}

describe('OIDCClient model — application_type', () => {
    it('defaults application_type to "web" when unset', () => {
        const redis = new OIDCClient().fromIncomingClient(incomingClient()).toRedis()
        expect(redis.application_type).toBe('web')
    })

    it('maps spec.applicationType "native" onto application_type', () => {
        const redis = new OIDCClient()
            .fromIncomingClient(incomingClient({
                applicationType: 'native',
                tokenEndpointAuthMethod: 'none',
                redirectUris: ['app.immich:///oauth-callback'],
            }))
            .toRedis()
        expect(redis.application_type).toBe('native')
        expect(redis.redirect_uris).toEqual(['app.immich:///oauth-callback'])
        expect(redis.token_endpoint_auth_method).toBe('none')
    })
})

describe('OIDCClient model — user ACL', () => {
    it('projects allowed users into provider metadata', () => {
        const client = new OIDCClient()
            .fromIncomingClient(incomingClient({allowedUsers: ['alice', 'bob']}))
        const redis = client.toRedis()

        expect(redis.allowedUsers).toEqual(['alice', 'bob'])
        expect(client.toClientSecret({urlFor: route => `https://oidc.example/${route}`}))
            .toMatchObject({OIDC_ALLOWED_USERS: 'alice,bob'})
    })
})

describe('OIDCClient model — scopes delimiter', () => {
    it('joins OIDC_AVAILABLE_SCOPES with a comma by default and honors the CR delimiter', () => {
        const urlFor = route => `https://oidc.example/${route}`
        const base = incomingClient({availableScopes: ['openid', 'email', 'profile']})

        expect(new OIDCClient().fromIncomingClient(base).toClientSecret({urlFor}))
            .toMatchObject({OIDC_AVAILABLE_SCOPES: 'openid,email,profile'})

        const spaced = incomingClient({
            availableScopes: ['openid', 'email', 'profile'],
            availableScopesDelimiter: ' ',
        })
        expect(new OIDCClient().fromIncomingClient(spaced).toClientSecret({urlFor}))
            .toMatchObject({OIDC_AVAILABLE_SCOPES: 'openid email profile'})
    })
})

describe('OIDCClient model — client URI in the generated Secret', () => {
    const urlFor = route => `https://oidc.example/${route}`
    const secretFor = (spec) =>
        new OIDCClient().fromIncomingClient(incomingClient(spec)).toClientSecret({urlFor})

    it('projects spec.uri and its origin into the Secret', () => {
        expect(secretFor({uri: 'https://app.example.com/gallery'})).toMatchObject({
            OIDC_CLIENT_URI: 'https://app.example.com/gallery',
            OIDC_CLIENT_ORIGIN: 'https://app.example.com',
        })
    })

    it('never emits a trailing slash, however the uri was written', () => {
        // NEXTAUTH_URL and friends treat a trailing slash as part of the path
        // and build broken callback URLs from it (#268). `new URL().href` would
        // *add* one to a bare origin, which is why this is not built from URL.
        for (const uri of ['https://app.example.com', 'https://app.example.com/']) {
            expect(secretFor({uri})).toMatchObject({
                OIDC_CLIENT_URI: 'https://app.example.com',
                OIDC_CLIENT_ORIGIN: 'https://app.example.com',
            })
        }
    })

    it('keeps a non-default port in the origin', () => {
        expect(secretFor({uri: 'https://app.example.com:8443/a/b'})).toMatchObject({
            OIDC_CLIENT_ORIGIN: 'https://app.example.com:8443',
        })
    })

    it('emits both keys empty when the client has no uri', () => {
        // spec.uri is optional. An absent key would break any Deployment
        // referencing it with secretKeyRef, so the keys are always present.
        const secret = secretFor({})

        expect(secret).toMatchObject({OIDC_CLIENT_URI: '', OIDC_CLIENT_ORIGIN: ''})
        expect(Object.keys(secret)).toContain('OIDC_CLIENT_URI')
        expect(Object.keys(secret)).toContain('OIDC_CLIENT_ORIGIN')
    })

    it('takes the uri an ingressRef resolved to', () => {
        // A client using spec.ingressRef has no spec.uri; the operator resolves
        // one from the Ingress host and applies it in memory.
        const client = new OIDCClient()
            .fromIncomingClient(incomingClient({uri: undefined}))
            .setResolvedIngress({
                uri: 'https://discovered.example.com/',
                redirectUris: ['https://discovered.example.com/callback'],
            })

        expect(client.toClientSecret({urlFor})).toMatchObject({
            OIDC_CLIENT_URI: 'https://discovered.example.com',
            OIDC_CLIENT_ORIGIN: 'https://discovered.example.com',
        })
    })
})
