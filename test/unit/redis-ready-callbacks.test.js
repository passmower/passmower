import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { EventEmitter } from 'node:events'

let emitter

vi.mock('ioredis', () => {
    const Redis = vi.fn(function () {
        // Assign the EventEmitter being used by the current test.
        Object.assign(this, emitter)
        this.options = emitter.options
        this.commandQueue = emitter.commandQueue
        this.quit = emitter.quit
        this.on = emitter.on.bind(emitter)
        this.emit = emitter.emit.bind(emitter)
        this.disconnect = emitter.disconnect
    })
    return { default: Redis }
})

const FAKE_URI = 'redis://localhost:6379'

beforeEach(() => {
    emitter = new EventEmitter()
    emitter.options = {}
    emitter.commandQueue = { length: 0 }
    emitter.quit = vi.fn().mockResolvedValue(undefined)
    emitter.disconnect = vi.fn()
    process.env.REDIS_URI = FAKE_URI
    vi.resetModules()
})

afterEach(() => {
    delete process.env.REDIS_URI
})

describe('onReady callbacks', () => {
    it('fires callback on every ready event, including reconnects', async () => {
        const { onReady, connect, disconnect } = await import('../../src/adapters/redis.js')

        const cb = vi.fn().mockResolvedValue(undefined)
        connect()
        onReady(cb)

        emitter.emit('ready')
        expect(cb).toHaveBeenCalledTimes(1)

        emitter.emit('ready')
        expect(cb).toHaveBeenCalledTimes(2)

        await disconnect()
    })

    it('clears callbacks after disconnect so they do not fire on a new connection', async () => {
        const { onReady, connect, disconnect } = await import('../../src/adapters/redis.js')

        const cb = vi.fn().mockResolvedValue(undefined)
        connect()
        onReady(cb)

        await disconnect()

        emitter.emit('ready')
        expect(cb).not.toHaveBeenCalled()
    })
})
