import {beforeEach, afterEach, describe, expect, it, vi} from 'vitest'
import {
    LeaderElection,
    podIdentity,
    isLeaderElectionEnabled,
    DEFAULT_LEASE_DURATION_SECONDS,
} from '../../src/services/leader-election.js'

// Just the Lease surface of the Kubernetes adapter, with the same error shapes:
// these methods deliberately throw rather than swallow, because the election
// loop has to tell a lost race from missing RBAC.
class FakeLeaseAdapter {
    constructor() {
        this.namespace = 'apps'
        this.lease = undefined
        this.failWith = null
        this.failWritesWith = null
        this.writes = 0
    }

    #maybeFail(code) {
        if (code) {
            const error = new Error(`fake ${code}`)
            error.code = code
            throw error
        }
    }

    async getLease(_namespace, _name) {
        this.#maybeFail(this.failWith)
        return this.lease
    }

    async createLease(_namespace, body) {
        this.#maybeFail(this.failWith ?? this.failWritesWith)
        if (this.lease) {
            const error = new Error('already exists')
            error.code = 409
            throw error
        }
        this.writes++
        this.lease = structuredClone(body)
        return this.lease
    }

    async replaceLease(_namespace, _name, body) {
        this.#maybeFail(this.failWith ?? this.failWritesWith)
        this.writes++
        this.lease = structuredClone(body)
        return this.lease
    }
}

const at = (iso) => () => new Date(iso)

describe('operator leader election', () => {
    let adapter, started, stopped

    const election = (overrides = {}) => new LeaderElection({
        adapter,
        identity: 'passmower-0',
        now: at('2026-09-18T12:00:00.000Z'),
        onStartedLeading: async () => { started++ },
        onStoppedLeading: async () => { stopped++ },
        ...overrides,
    })

    beforeEach(() => {
        globalThis.logger = {debug() {}, info() {}, warn() {}, error() {}, trace() {}}
        adapter = new FakeLeaseAdapter()
        started = 0
        stopped = 0
    })

    afterEach(() => { vi.useRealTimers() })

    it('creates the lease and starts leading when none exists', async () => {
        const subject = election()
        await subject.start()

        expect(started).toBe(1)
        expect(subject.leading).toBe(true)
        expect(adapter.lease.spec).toMatchObject({
            holderIdentity: 'passmower-0',
            leaseDurationSeconds: DEFAULT_LEASE_DURATION_SECONDS,
            leaseTransitions: 1,
        })
    })

    it('does not start leading while another pod holds a live lease', async () => {
        adapter.lease = {
            metadata: {name: 'passmower-operators'},
            spec: {
                holderIdentity: 'passmower-1',
                leaseDurationSeconds: 15,
                renewTime: '2026-09-18T11:59:55.000Z',
            },
        }
        const subject = election()
        await subject.start()

        expect(started).toBe(0)
        expect(subject.leading).toBe(false)
        expect(adapter.lease.spec.holderIdentity).toBe('passmower-1')
    })

    it('takes over a lease whose holder stopped renewing', async () => {
        adapter.lease = {
            metadata: {name: 'passmower-operators'},
            spec: {
                holderIdentity: 'passmower-1',
                leaseDurationSeconds: 15,
                renewTime: '2026-09-18T11:59:00.000Z',
                leaseTransitions: 4,
            },
        }
        const subject = election()
        await subject.start()

        expect(started).toBe(1)
        expect(adapter.lease.spec).toMatchObject({
            holderIdentity: 'passmower-0',
            leaseTransitions: 5,
        })
    })

    it('takes over a lease that was released rather than left to expire', async () => {
        adapter.lease = {
            metadata: {name: 'passmower-operators'},
            spec: {holderIdentity: null, renewTime: null, leaseTransitions: 2},
        }
        const subject = election()
        await subject.start()

        expect(started).toBe(1)
        expect(adapter.lease.spec.holderIdentity).toBe('passmower-0')
    })

    // A lease it still holds is just renewed — the operators must not be
    // restarted on every tick.
    it('renews its own lease without re-entering leadership', async () => {
        const subject = election()
        await subject.start()
        adapter.failWith = null
        await subject.tick()

        expect(started).toBe(1)
        expect(adapter.lease.spec.holderIdentity).toBe('passmower-0')
    })

    // Handing the lease back means the next pod does not wait out a whole lease
    // duration, which on a single-replica restart is dead time for nothing.
    it('releases the lease on stop', async () => {
        const subject = election()
        await subject.start()
        await subject.stop()

        expect(stopped).toBe(1)
        expect(adapter.lease.spec.holderIdentity).toBeNull()
    })

    it('stands down when another pod has taken the lease', async () => {
        const subject = election()
        await subject.start()
        expect(started).toBe(1)

        adapter.lease = {
            metadata: {name: 'passmower-operators'},
            spec: {
                holderIdentity: 'passmower-1',
                leaseDurationSeconds: 15,
                renewTime: '2026-09-18T11:59:58.000Z',
            },
        }
        await subject.tick()

        expect(stopped).toBe(1)
        expect(subject.leading).toBe(false)
    })

    // Passmower with no reconciler is far worse than Passmower with several,
    // which is what every release before leader election did. An upgrade that
    // takes the image but not the chart RBAC must not stop reconciling.
    it('runs the operators anyway when it may not touch leases', async () => {
        adapter.failWith = 403
        const subject = election()
        await subject.start()

        expect(started).toBe(1)
        expect(subject.timer).toBeNull() // stopped polling, it will never succeed
    })

    it('keeps retrying on a transient API error without standing down', async () => {
        const subject = election()
        await subject.start()
        expect(started).toBe(1)

        adapter.failWith = 500
        await subject.tick().catch(() => {})

        expect(stopped).toBe(0)
        expect(subject.leading).toBe(true)
    })

    // Losing one renewal race is not losing the lease; the renew deadline is.
    it('keeps leading through a single conflicting renewal', async () => {
        let clock = new Date('2026-09-18T12:00:00.000Z')
        const subject = election({now: () => clock})
        await subject.start()
        expect(started).toBe(1)

        adapter.failWritesWith = 409
        clock = new Date('2026-09-18T12:00:03.000Z')
        await subject.tick()

        expect(subject.leading).toBe(true)
        expect(stopped).toBe(0)
    })

    it('stands down once renewals fail past the renew deadline', async () => {
        let clock = new Date('2026-09-18T12:00:00.000Z')
        const subject = election({now: () => clock})
        await subject.start()

        adapter.failWritesWith = 409
        clock = new Date('2026-09-18T12:00:30.000Z')
        await subject.tick()

        expect(subject.leading).toBe(false)
        expect(stopped).toBe(1)
    })
})

describe('leader election configuration', () => {
    it('prefers the pod name over the hostname', () => {
        expect(podIdentity({POD_NAME: 'passmower-abc'})).toBe('passmower-abc')
        expect(podIdentity({})).toBeTruthy()
    })

    it('is on unless explicitly disabled', () => {
        expect(isLeaderElectionEnabled({})).toBe(true)
        expect(isLeaderElectionEnabled({LEADER_ELECTION_ENABLED: 'true'})).toBe(true)
        expect(isLeaderElectionEnabled({LEADER_ELECTION_ENABLED: 'false'})).toBe(false)
    })
})
