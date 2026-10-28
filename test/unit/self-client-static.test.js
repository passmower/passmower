import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { clientId, responseType, scope, buildSelfOidcClient } from '../../src/utils/session/self-oidc-client.js'

describe('buildSelfOidcClient', () => {
    const ISSUER = 'https://auth.example.com/'
    let previousIssuer

    beforeEach(() => {
        previousIssuer = process.env.ISSUER_URL
        process.env.ISSUER_URL = ISSUER
    })

    afterEach(() => {
        process.env.ISSUER_URL = previousIssuer
    })

    it('returns the correct client_id, grant and response types', () => {
        const client = buildSelfOidcClient()
        expect(client.client_id).toBe(clientId)
        expect(client.grant_types).toEqual(['implicit'])
        expect(client.response_types).toEqual([responseType])
    })

    it('sets redirect_uris to [ISSUER_URL]', () => {
        const client = buildSelfOidcClient()
        expect(client.redirect_uris).toEqual([ISSUER])
    })

    it('sets availableScopes to [scope]', () => {
        const client = buildSelfOidcClient()
        expect(client.availableScopes).toEqual([scope])
    })

    it('has no uri field so getEnrolledApps ignores it', () => {
        const client = buildSelfOidcClient()
        expect(client).not.toHaveProperty('uri')
    })

    it('generates a unique client_secret on each call', () => {
        const a = buildSelfOidcClient()
        const b = buildSelfOidcClient()
        expect(a.client_secret).not.toBe(b.client_secret)
    })
})
