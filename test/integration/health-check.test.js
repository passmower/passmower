import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { checkHealth } from '../../src/routes/metrics-server.js'

// #77: the health check must verify Redis is writable, not just reachable.
describe('checkHealth', () => {
    beforeAll(() => {
        process.env.REDIS_URI ??= 'redis://127.0.0.1:6379'
        globalThis.logger ??= { info() {}, warn() {}, error() {}, debug() {}, trace() {} }
    })

    afterAll(async () => {
        const { disconnect } = await import('../../src/adapters/redis.js')
        await disconnect()
    })

    it('returns true when Kubernetes is reachable and Redis is writable', async () => {
        const userService = { async listUsers() { return [] } } // fake kube, reachable
        expect(await checkHealth(userService)).toBe(true)

        // confirm the probe was actually written to Redis
        const { default: RedisAdapter } = await import('../../src/adapters/redis.js')
        expect(await new RedisAdapter('HealthCheck').find('probe')).toBeTruthy()
    })

    it('propagates a Kubernetes failure (rejects) so /health can 500', async () => {
        const userService = { async listUsers() { throw new Error('api down') } }
        await expect(checkHealth(userService)).rejects.toThrow('api down')
    })
})
