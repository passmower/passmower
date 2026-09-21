import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import Koa from 'koa'
import Router from '@koa/router'
import request from 'supertest'
import { checkReadiness, probeRoutes } from '../../src/routes/metrics-server.js'

const probeApp = (options) => {
    const app = new Koa()
    app.use(probeRoutes(new Router(), options).routes())
    return app.callback()
}

// #77: the dependency check must verify Redis is writable, not just reachable.
// #265: it belongs on readiness, not liveness — a Redis outage takes a pod out
// of the Service, it does not restart it.
describe('probe endpoints', () => {
    const reachable = { async listUsers() { return [] } } // fake kube, reachable
    const unreachable = { async listUsers() { throw new Error('api down') } }

    beforeAll(() => {
        process.env.REDIS_URI ??= 'redis://127.0.0.1:6379'
        globalThis.logger ??= { info() {}, warn() {}, error() {}, debug() {}, trace() {} }
    })

    afterAll(async () => {
        const { disconnect } = await import('../../src/adapters/redis.js')
        await disconnect()
    })

    describe('checkReadiness', () => {
        it('returns true when Kubernetes is reachable and Redis is writable', async () => {
            expect(await checkReadiness(reachable)).toBe(true)

            // confirm the probe was actually written to Redis
            const { default: RedisAdapter } = await import('../../src/adapters/redis.js')
            expect(await new RedisAdapter('HealthCheck').find('probe')).toBeTruthy()
        })

        it('propagates a Kubernetes failure (rejects) so /ready can 503', async () => {
            await expect(checkReadiness(unreachable)).rejects.toThrow('api down')
        })
    })

    describe('/ready', () => {
        it('is 200 when both dependencies answer', async () => {
            await request(probeApp({userService: reachable})).get('/ready').expect(200)
        })

        it('is 503, not 500, when a dependency is down', async () => {
            await request(probeApp({userService: unreachable})).get('/ready').expect(503)
        })

        it('is 503 while the provider has not finished booting', async () => {
            await request(probeApp({userService: reachable, isServing: () => false}))
                .get('/ready').expect(503)
        })
    })

    describe('/health', () => {
        // The regression #265 is about: liveness must not depend on anything a
        // restart cannot fix. Both dependencies are down here and it still
        // passes, because the process itself is fine.
        it('is 200 even when every dependency is down', async () => {
            await request(probeApp({userService: unreachable, isServing: () => false}))
                .get('/health').expect(200)
        })

        it('does not touch Redis', async () => {
            const exploding = new Proxy({}, {get() { throw new Error('liveness must not read Redis') }})
            await request(probeApp({userService: exploding})).get('/health').expect(200)
        })
    })
})
