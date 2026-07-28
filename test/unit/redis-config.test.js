import { describe, expect, it } from 'vitest'
import { getRedisUrl } from '../../src/adapters/redis.js'

describe('getRedisUrl', () => {
    it('prefers REDIS_URI over sliced configuration', () => {
        expect(getRedisUrl({
            REDIS_URI: 'rediss://redis.example.com:6380/4',
            REDIS_HOST: 'ignored.example.com',
        })).toBe('rediss://redis.example.com:6380/4')
    })

    it('returns undefined when neither a URI nor a host is configured', () => {
        expect(getRedisUrl({})).toBeUndefined()
    })

    it('builds a URL with default port and database', () => {
        expect(getRedisUrl({ REDIS_HOST: 'redis.example.com' }))
            .toBe('redis://redis.example.com:6379/0')
    })

    it('builds a URL from all sliced fields and encodes credentials', () => {
        expect(getRedisUrl({
            REDIS_HOST: 'redis.example.com',
            REDIS_PORT: '6380',
            REDIS_USERNAME: 'user@example.com',
            REDIS_PASSWORD: 'slash/colon:#',
            REDIS_DB: '12',
        })).toBe('redis://user%40example.com:slash%2Fcolon%3A%23@redis.example.com:6380/12')
    })

    it('supports password-only authentication and IPv6 hosts', () => {
        expect(getRedisUrl({
            REDIS_HOST: '2001:db8::1',
            REDIS_PASSWORD: 'secret',
        })).toBe('redis://:secret@[2001:db8::1]:6379/0')
    })

    it.each([
        [{ REDIS_HOST: 'redis', REDIS_PORT: '0' }, 'REDIS_PORT'],
        [{ REDIS_HOST: 'redis', REDIS_PORT: '65536' }, 'REDIS_PORT'],
        [{ REDIS_HOST: 'redis', REDIS_PORT: 'abc' }, 'REDIS_PORT'],
        [{ REDIS_HOST: 'redis', REDIS_DB: '-1' }, 'REDIS_DB'],
        [{ REDIS_HOST: 'redis', REDIS_DB: 'db' }, 'REDIS_DB'],
    ])('rejects invalid sliced configuration %#', (env, field) => {
        expect(() => getRedisUrl(env)).toThrow(field)
    })
})
