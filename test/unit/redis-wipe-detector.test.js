import { describe, it, expect, beforeEach, vi } from 'vitest'
import { RedisWipeDetector, restartOnRedisWipe } from '../../src/services/redis-wipe-detector.js'

class FakeRedisAdapter {
    constructor() { this.store = new Map() }
    async find(id) { return this.store.get(id) }
    async upsert(id, payload) { this.store.set(id, payload) }
    wipe() { this.store.clear() }
}

describe('RedisWipeDetector', () => {
    let redisAdapter

    beforeEach(() => {
        globalThis.logger = { debug() {}, info() {}, warn() {}, error() {} }
        redisAdapter = new FakeRedisAdapter()
    })

    const detectorFor = (onWipe) => new RedisWipeDetector(onWipe, { intervalMs: 60_000, redisAdapter })

    it('does nothing while the marker it wrote is present', async () => {
        const onWipe = vi.fn()
        const detector = detectorFor(onWipe)
        await detector.start()
        detector.stop()

        expect(await detector.check()).toBe(false)
        expect(onWipe).not.toHaveBeenCalled()
    })

    it('replays once when the marker is gone, and marks again first', async () => {
        const onWipe = vi.fn(async () => {
            expect(await redisAdapter.find('present')).toBeTruthy()
        })
        const detector = detectorFor(onWipe)
        await detector.start()
        detector.stop()

        redisAdapter.wipe()
        expect(await detector.check()).toBe(true)
        expect(await detector.check()).toBe(false)
        expect(onWipe).toHaveBeenCalledTimes(1)
    })

    it('does not overlap a replay that is still running', async () => {
        let release
        const onWipe = vi.fn(() => new Promise(resolve => { release = resolve }))
        const detector = detectorFor(onWipe)

        const first = detector.check()
        expect(await detector.check()).toBe(false)
        await vi.waitFor(() => expect(release).toBeDefined())
        release()
        expect(await first).toBe(true)
        expect(onWipe).toHaveBeenCalledTimes(1)
    })

    it('starts without throwing when the marker cannot be written', async () => {
        redisAdapter.upsert = async () => { throw new Error('Connection is closed') }
        const detector = detectorFor(vi.fn())
        await expect(detector.start()).resolves.toBeUndefined()
        detector.stop()
    })
})

describe('restartOnRedisWipe', () => {
    beforeEach(() => {
        globalThis.logger = { debug() {}, info() {}, warn() {}, error() {} }
    })

    const startable = () => {
        const stops = []
        const start = vi.fn(async () => {
            const stop = vi.fn()
            stops.push(stop)
            return stop
        })
        return { start, stops }
    }

    it('stops what it started and starts it again when Redis is wiped', async () => {
        const redisAdapter = new FakeRedisAdapter()
        const { start, stops } = startable()
        const stopAll = await restartOnRedisWipe(start, { intervalMs: 5, redisAdapter })
        expect(start).toHaveBeenCalledTimes(1)

        redisAdapter.wipe()
        await vi.waitFor(() => expect(start).toHaveBeenCalledTimes(2))
        expect(stops[0]).toHaveBeenCalledTimes(1)
        expect(stops[1]).not.toHaveBeenCalled()

        stopAll()
        expect(stops[1]).toHaveBeenCalledTimes(1)
    })

    it('stops a restart that finishes after it was stood down', async () => {
        const redisAdapter = new FakeRedisAdapter()
        const { start, stops } = startable()
        let release
        const slowStart = vi.fn(async () => {
            if (start.mock.calls.length) {
                await new Promise(resolve => { release = resolve })
            }
            return start()
        })
        const stopAll = await restartOnRedisWipe(slowStart, { intervalMs: 5, redisAdapter })

        redisAdapter.wipe()
        await vi.waitFor(() => expect(release).toBeDefined())
        stopAll()
        release()
        await vi.waitFor(() => expect(stops[1]).toHaveBeenCalledTimes(1))
        expect(stops[0]).toHaveBeenCalled()
    })
})
