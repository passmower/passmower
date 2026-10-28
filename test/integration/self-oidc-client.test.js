import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import request from 'supertest'
import Redis from 'ioredis'
import { setupLogger } from '../../src/providers/setup-logger.js'

// The dashboard logs in through the self client (client_id=passmower). It is
// static provider configuration, so a Redis that loses its data must not take
// the dashboard login down with "client not found".
describe('self OIDC client survives a Redis wipe', () => {
    let agent
    let redis

    const authorize = () => agent.get('/auth').query({
        client_id: 'passmower',
        response_type: 'id_token',
        scope: 'openid',
        nonce: 'nonce',
        redirect_uri: process.env.ISSUER_URL,
    })

    beforeAll(async () => {
        process.env.REDIS_URI ??= 'redis://127.0.0.1:6379'
        setupLogger()
        redis = new Redis(process.env.REDIS_URI)
        // A record an older version stored, which boot is expected to remove.
        await redis.set('oidc:Client:passmower', JSON.stringify({ client_id: 'passmower', kind: 'SelfOIDCClient' }))
        await redis.sadd('oidc:Clients:1', 'passmower')
        const { buildProvider } = await import('../../src/app.js')
        agent = request((await buildProvider()).callback())
    })

    afterAll(async () => {
        redis?.disconnect()
        const { disconnect } = await import('../../src/adapters/redis.js')
        await disconnect()
    })

    it('removes the self client record older versions stored in Redis', async () => {
        expect(await redis.exists('oidc:Client:passmower')).toBe(0)
        expect(await redis.sismember('oidc:Clients:1', 'passmower')).toBe(0)
    })

    it('starts the dashboard login after Redis is flushed', async () => {
        await authorize().expect(303)

        await redis.flushdb()

        const res = await authorize()
        expect(res.status).toBe(303)
        expect(res.headers.location).toMatch(/\/interaction\//)
    })
})
