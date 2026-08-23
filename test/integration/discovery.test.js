import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import request from 'supertest'
import { setupLogger } from '../../src/providers/setup-logger.js'

// Smoke-level HTTP integration: build the real provider (with the real Redis
// adapter) and assert the OIDC surface is correctly wired and served.
describe('OIDC discovery + authorization endpoint', () => {
    let provider
    let agent

    beforeAll(async () => {
        process.env.REDIS_URI ??= 'redis://127.0.0.1:6379'
        setupLogger()
        const { buildProvider } = await import('../../src/app.js')
        provider = await buildProvider()
        agent = request(provider.callback())
    })

    afterAll(async () => {
        const { disconnect } = await import('../../src/adapters/redis.js')
        await disconnect()
    })

    it('serves a discovery document with the configured issuer and endpoints', async () => {
        const res = await agent.get('/.well-known/openid-configuration').expect(200)
        expect(res.body.issuer).toBe(process.env.ISSUER_URL)
        expect(res.body.authorization_endpoint).toContain('/auth')
        expect(res.body.token_endpoint).toContain('/token')
        expect(res.body.jwks_uri).toContain('/jwks')
        expect(res.body.code_challenge_methods_supported).toContain('S256')
    })

    it('publishes signing keys at the jwks endpoint', async () => {
        const res = await agent.get('/jwks').expect(200)
        expect(Array.isArray(res.body.keys)).toBe(true)
        expect(res.body.keys.length).toBeGreaterThan(0)
        expect(res.body.keys[0]).toMatchObject({ kty: 'RSA', use: 'sig' })
        // Private material must never be published.
        expect(res.body.keys[0].d).toBeUndefined()
    })
})
