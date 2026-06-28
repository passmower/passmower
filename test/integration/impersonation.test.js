import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import request from 'supertest'

// #51: impersonation is started via a one-time link the admin opens in a clean
// (incognito / other-device) browser, so their own and downstream apps' cookies
// never mix with the impersonated user's session.
describe('impersonation links', () => {
    let provider
    let callback

    beforeAll(async () => {
        process.env.REDIS_URI ??= 'redis://127.0.0.1:6379'
        globalThis.logger = { debug() {}, info() {}, warn() {}, error() {}, trace() {} }
        const { buildProvider } = await import('../../src/app.js')
        provider = await buildProvider()
        callback = provider.callback()
    })

    afterAll(async () => {
        const { disconnect } = await import('../../src/adapters/redis.js')
        await disconnect()
    })

    async function seedLink(jti, overrides = {}) {
        const { default: RedisAdapter } = await import('../../src/adapters/redis.js')
        await new RedisAdapter('Impersonation').upsert(jti, {
            jti, actor: 'admin', accountId: 'target-user', activated: false, ...overrides,
        }, 3600)
    }

    it('refuses to activate when cookies are already present (not a clean browser)', async () => {
        await seedLink('jti-cookies')
        const res = await request(callback).get('/impersonate/jti-cookies').set('Cookie', '_session=abc')
        expect(res.status).toBe(200)
        expect(res.text).toMatch(/private|incognito/i)
        expect(res.headers['set-cookie']).toBeUndefined() // impersonation NOT activated
    })

    it('activates in a clean browser and sets the impersonation cookie', async () => {
        await seedLink('jti-clean')
        const res = await request(callback).get('/impersonate/jti-clean')
        expect(res.status).toBe(302)
        expect(res.headers.location).toBe(process.env.ISSUER_URL)
        expect((res.headers['set-cookie'] || []).join(';')).toMatch(/_impersonation=/)
    })

    it('is one-time: an already-activated link is rejected', async () => {
        await seedLink('jti-used', { activated: true })
        const res = await request(callback).get('/impersonate/jti-used')
        expect(res.status).toBe(200)
        expect(res.text).toMatch(/invalid|already been used/i)
    })

    it('rejects an unknown link', async () => {
        const res = await request(callback).get('/impersonate/does-not-exist')
        expect(res.status).toBe(200)
        expect(res.text).toMatch(/invalid|already been used/i)
    })

    it('createImpersonation returns a link without touching cookies', async () => {
        const { SessionService } = await import('../../src/services/session-service.js')
        const service = new SessionService(provider)
        const ctx = {
            adminSession: { accountId: 'admin' },
            kubeOIDCUserService: { async findUser() { return { accountId: 'target-user' } } },
        }
        const result = await service.createImpersonation(ctx, 'target-user')
        expect(result.accountId).toBe('target-user')
        expect(result.link).toMatch(/\/impersonate\/[\w-]+$/)
    })
})
