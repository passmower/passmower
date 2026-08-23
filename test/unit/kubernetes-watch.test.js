import {describe, expect, it} from 'vitest'
import {WATCH_TIMEOUT_MS, watchRestartDelayMs} from '../../src/adapters/kubernetes.js'

describe('kubernetes watch lifecycle', () => {
    it('keeps the watch request alive far beyond the client default 30s', () => {
        expect(WATCH_TIMEOUT_MS).toBeGreaterThanOrEqual(10 * 60 * 1000)
    })

    it('reconnects immediately on expected termination, backs off on errors', () => {
        // clean end (apiserver closed the watch)
        expect(watchRestartDelayMs(null)).toBe(0)
        expect(watchRestartDelayMs(undefined)).toBe(0)
        // client-node 2.x requestTimeoutMs abort
        expect(watchRestartDelayMs(new DOMException('The operation was aborted due to timeout', 'TimeoutError'))).toBe(0)
        // genuine failure
        expect(watchRestartDelayMs(new Error('connection refused'))).toBe(10 * 1000)
    })
})
