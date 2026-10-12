import { beforeEach, describe, expect, it, vi } from 'vitest'

// Intercept the redis module so we can capture registered onRedisReady callbacks
// without opening a real connection, then drive them manually to simulate a reconnect.
const readyCallbacks = new Set()

vi.mock('../../src/adapters/redis.js', async (importOriginal) => {
    const actual = await importOriginal()
    return {
        ...actual,
        onRedisReady: (cb) => readyCallbacks.add(cb),
    }
})

const { initializeSelfOidcClient, getSelfOidcClient, clientId } = await import('../../src/utils/session/self-oidc-client.js')

// Minimal fake RedisAdapter whose find/upsert are patched per test.
const RedisAdapter = (await import('../../src/adapters/redis.js')).default

describe('self-oidc-client recovery after Redis reconnect', () => {
    beforeEach(() => {
        readyCallbacks.clear()
        vi.spyOn(RedisAdapter.prototype, 'upsert').mockResolvedValue(undefined)
        vi.spyOn(RedisAdapter.prototype, 'find').mockResolvedValue(undefined)
        process.env.ISSUER_URL = 'https://auth.example.com/'
    })

    it('registers a ready callback during initialization', async () => {
        await initializeSelfOidcClient()
        expect(readyCallbacks.size).toBe(1)
    })

    it('does not register a duplicate callback on repeated initialization', async () => {
        await initializeSelfOidcClient()
        await initializeSelfOidcClient()
        expect(readyCallbacks.size).toBe(1)
    })

    it('re-seeds the self-client when the ready callback fires after a flush', async () => {
        await initializeSelfOidcClient()

        // Simulate Redis being flushed: find returns nothing
        RedisAdapter.prototype.find.mockResolvedValue(undefined)
        const upsertSpy = RedisAdapter.prototype.upsert

        // Fire the reconnect callback as Redis would after it comes back up
        for (const cb of readyCallbacks) await cb()

        expect(upsertSpy).toHaveBeenCalledWith(
            clientId,
            expect.objectContaining({ client_id: clientId, kind: 'SelfOIDCClient' }),
        )
    })

    it('preserves in-memory redirect_uris when Redis has no record after flush', async () => {
        // Give the client some URIs on first init (as if the operator added them)
        const existingUris = ['https://auth.example.com/', 'https://app.example.com/']
        RedisAdapter.prototype.find.mockResolvedValueOnce({ redirect_uris: existingUris })
        await initializeSelfOidcClient()

        // Now Redis is flushed — find returns nothing
        RedisAdapter.prototype.find.mockResolvedValue(undefined)
        const upsertSpy = RedisAdapter.prototype.upsert

        for (const cb of readyCallbacks) await cb()

        const written = upsertSpy.mock.calls.at(-1)[1]
        expect(written.redirect_uris).toEqual(expect.arrayContaining(['https://auth.example.com/']))
    })
})
