import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import request from 'supertest'
import Redis from 'ioredis'
import { setupLogger } from '../../src/providers/setup-logger.js'

// The dashboard logs in through the self client (client_id=passmower), which is
// written to Redis once at boot. A Redis that loses its data must not leave the
// dashboard with "client not found" until the pod restarts.
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
        const { buildProvider } = await import('../../src/app.js')
        agent = request((await buildProvider()).callback())
        redis = new Redis(process.env.REDIS_URI)
    })

    afterAll(async () => {
        redis?.disconnect()
        const { disconnect } = await import('../../src/adapters/redis.js')
        await disconnect()
    })

    it('starts the dashboard login after Client:passmower is deleted', async () => {
        await authorize().expect(303)

        expect(await redis.del('oidc:Client:passmower')).toBe(1)

        const res = await authorize()
        expect(res.status).toBe(303)
        expect(res.headers.location).toMatch(/\/interaction\//)

        const restored = JSON.parse(await redis.get('oidc:Client:passmower'))
        expect(restored).toMatchObject({
            client_id: 'passmower',
            kind: 'SelfOIDCClient',
            redirect_uris: [process.env.ISSUER_URL],
        })
    })
})
