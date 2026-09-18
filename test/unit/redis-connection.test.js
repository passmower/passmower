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

    // 2, not true: ioredis rejects the failed command on `true` and resends it
    // only on 2. Reconnecting without resending drops the write that hit a
    // replica mid-failover, and a dropped delete is never replayed — which is
    // how clients outlived their CRs in Redis (#257).
    it.each(['READONLY', 'MOVED', 'ASK', 'CLUSTERDOWN'])(
        'reconnects and resends the failed command on %s failover errors',
        error => {
            const { reconnectOnError } = getRedisOptions()

            expect(reconnectOnError(new Error(`${error} failover`))).toBe(2)
        },
    )

    it('does not reconnect on unrelated Redis errors', () => {
        const { reconnectOnError } = getRedisOptions()

        expect(reconnectOnError(new Error('WRONGTYPE operation'))).toBe(false)
    })
})
