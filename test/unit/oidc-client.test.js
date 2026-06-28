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
