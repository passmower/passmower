import RedisAdapter from '../adapters/redis.js'

export const DEFAULT_CHECK_INTERVAL_MS = 30 * 1000

const markerId = 'present'

// Notices when Redis has lost its data while Passmower keeps running: an
// in-memory store restarted, or someone flushed it. Client records are written
// by the operators' watches, and a watch that stays connected never replays
// what it already delivered, so nothing would put them back until the watch
// ends on its own, up to WATCH_TIMEOUT_MS later. Until then every application
// login fails with invalid_client (#309).
//
// A marker is written at start. Whatever removes it removes everything written
// alongside it, so one check covers both a flush, where the connection
// survives, and a restart, where it does not.
export class RedisWipeDetector {
    constructor(
        onWipe,
        {intervalMs = DEFAULT_CHECK_INTERVAL_MS, redisAdapter = new RedisAdapter('WipeMarker')} = {},
    ) {
        this.onWipe = onWipe
        this.intervalMs = intervalMs
        this.redisAdapter = redisAdapter
        this.timer = undefined
        this.running = false
    }

    // Resolves once the marker is written. A marker that fails to land only
    // means a spurious replay at the first check, which is harmless: a replay
    // is what every watch reconnect does.
    async start() {
        if (this.timer) {
            return
        }
        this.timer = setInterval(() => this.#checkQuietly(), this.intervalMs)
        this.timer.unref?.()
        await this.#mark().catch((error) => {
            globalThis.logger.warn({error}, 'Redis wipe marker could not be written')
        })
    }

    stop() {
        clearInterval(this.timer)
        this.timer = undefined
    }

    #checkQuietly() {
        this.check().catch((error) => {
            globalThis.logger.warn({error}, 'Redis wipe check failed')
        })
    }

    // Returns whether a wipe was found, so tests can assert on the check rather
    // than on the timer.
    async check() {
        if (this.running) {
            return false
        }
        this.running = true
        try {
            if (await this.redisAdapter.find(markerId)) {
                return false
            }
            globalThis.logger.warn('Redis lost its data, replaying Kubernetes resources into it')
            // Marked before the replay, so a wipe during it is caught next round.
            await this.#mark()
            await this.onWipe()
            return true
        } finally {
            this.running = false
        }
    }

    async #mark() {
        await this.redisAdapter.upsert(markerId, {markedAt: new Date().toISOString()})
    }
}

// Run start(), which returns a stop function, and run it afresh whenever Redis
// loses its data. Returns a stop function for the whole arrangement.
export async function restartOnRedisWipe(start, options) {
    let stop = await start()
    let stopped = false
    const detector = new RedisWipeDetector(async () => {
        stop()
        const restarted = await start()
        // Stood down while restarting: don't leave the new ones running.
        if (stopped) {
            restarted()
        } else {
            stop = restarted
        }
    }, options)
    await detector.start()
    return () => {
        stopped = true
        detector.stop()
        stop()
    }
}
