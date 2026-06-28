import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import request from 'supertest'

// Native/mobile apps (immich, the Nextcloud Android app) register custom-scheme
// or http-loopback redirect URIs, which oidc-provider only accepts for clients
// with application_type: 'native'. Regression test for #66 / #46.
describe('native client custom-scheme redirect URIs', () => {
    let callback

    const NATIVE_REDIRECT = 'app.immich:///oauth-callback'
    const base = {
        grant_types: ['authorization_code'],
        response_types: ['code'],
        token_endpoint_auth_method: 'none',
        availableScopes: ['openid'],
        allowedCORSOrigins: [],
        redirect_uris: [NATIVE_REDIRECT],
    }

    beforeAll(async () => {
        process.env.REDIS_URI ??= 'redis://127.0.0.1:6379'
        globalThis.logger = { debug() {}, info() {}, warn() {}, error() {}, trace() {} }
        // metricsServer() isn't run for HTTP tests; stub the metrics the error
        // path increments so authorization.error doesn't NPE.
        globalThis.metrics = new Proxy({}, { get: () => ({ labelNames: [], inc() {} }) })

        const { buildProvider } = await import('../../src/app.js')
        callback = (await buildProvider()).callback()

        const { default: RedisAdapter } = await import('../../src/adapters/redis.js')
        await new RedisAdapter('Client').upsert('native-rp', { ...base, client_id: 'native-rp', application_type: 'native' })
        await new RedisAdapter('Client').upsert('web-rp', { ...base, client_id: 'web-rp', application_type: 'web' })
    })

    afterAll(async () => {
        const { disconnect } = await import('../../src/adapters/redis.js')
        await disconnect()
    })

    function authReq(clientId) {
        const q = new URLSearchParams({
            client_id: clientId,
            response_type: 'code',
            redirect_uri: NATIVE_REDIRECT,
            scope: 'openid',
            code_challenge: 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM',
            code_challenge_method: 'S256',
            state: 's',
        })
        return request(callback).get(`/auth?${q}`)
    }

    it('accepts a custom-scheme redirect for a native client', async () => {
        const res = await authReq('native-rp')
        expect(res.status).toBe(303)
        expect(res.headers.location).toMatch(/\/interaction\//)
    })

    it('rejects the same custom-scheme redirect for a web client', async () => {
        const res = await authReq('web-rp')
        // oidc-provider renders an error page (not a redirect to the interaction).
        expect(res.status).not.toBe(303)
        expect(res.text).toMatch(/redirect_uri|invalid_redirect_uri|web clients/i)
    })
})
