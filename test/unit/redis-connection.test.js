import { describe, expect, it } from 'vitest'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { getRedisOptions, getRedisTlsOptions } from '../../src/adapters/redis.js'

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

    // Without a tls option ioredis derives it from a rediss:// URL alone, so
    // the environment must not plant one that a plain redis:// URI would honour.
    it('sets no tls option unless TLS is configured', () => {
        expect(getRedisOptions(false, {})).not.toHaveProperty('tls')
        expect(getRedisTlsOptions({ REDIS_TLS: 'false' })).toBeUndefined()
    })

    it('enables TLS with defaults when only REDIS_TLS is set', () => {
        expect(getRedisOptions(false, { REDIS_TLS: 'true' }).tls).toEqual({})
    })

    it('maps the TLS environment onto tls.connect() options', () => {
        const dir = mkdtempSync(join(tmpdir(), 'redis-tls-'))
        const caFile = join(dir, 'ca.crt')
        writeFileSync(caFile, 'PEM-FROM-FILE')

        expect(getRedisTlsOptions({
            REDIS_TLS: 'true',
            REDIS_TLS_CA_FILE: caFile,
            REDIS_TLS_SERVERNAME: 'redis.internal',
            REDIS_TLS_INSECURE_SKIP_VERIFY: 'true',
        })).toEqual({
            ca: 'PEM-FROM-FILE',
            servername: 'redis.internal',
            rejectUnauthorized: false,
        })
    })

    it('accepts inline CA content and implies TLS from any TLS detail', () => {
        expect(getRedisTlsOptions({ REDIS_TLS_CA: 'PEM-INLINE' })).toEqual({ ca: 'PEM-INLINE' })
    })
})
