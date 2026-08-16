import { describe, expect, it } from 'vitest'
import { getRedisOptions } from '../../src/adapters/redis.js'

describe('Redis connection options', () => {
    it('uses RESP3 and the ioredis retry strategy', () => {
        const options = getRedisOptions(true, { REDIS_IP_FAMILY: '6' })

        expect(options).toMatchObject({
            keyPrefix: 'oidc:',
            family: 6,
            protocol: 3,
            enableOfflineQueue: true,
            connectTimeout: 10000,
        })
        expect(options).not.toHaveProperty('retryStrategy')
    })

    it('disables the offline queue on replacement connections', () => {
        expect(getRedisOptions(false, {})).toMatchObject({
            family: 0,
            protocol: 3,
            enableOfflineQueue: false,
        })
    })

    it.each(['READONLY', 'MOVED', 'ASK', 'CLUSTERDOWN'])(
        'reconnects on %s failover errors',
        error => {
            const { reconnectOnError } = getRedisOptions()

            expect(reconnectOnError(new Error(`${error} failover`))).toBe(true)
        },
    )

    it('does not reconnect on unrelated Redis errors', () => {
        const { reconnectOnError } = getRedisOptions()

        expect(reconnectOnError(new Error('WRONGTYPE operation'))).toBe(false)
    })
})
