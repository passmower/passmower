import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'
import {
    aggregateSessionUsage,
    countGroupMembers,
    groupMetricsEnabled,
    setGroupMembershipMetrics,
} from '../../src/utils/usage-metrics.js'

describe('usage metrics', () => {
    it('aggregates sessions and unique users from stored session payloads', () => {
        const payloads = [
            JSON.stringify({jti: 's1', accountId: 'alice'}),
            JSON.stringify({jti: 's2', accountId: 'alice'}),
            JSON.stringify({jti: 's3', accountId: 'bob'}),
            JSON.stringify({jti: 's4'}), // anonymous / pre-login
            'not json',                  // unreadable record still counts as a session
            null,                        // expired between SCAN and MGET
        ]
        expect(aggregateSessionUsage(payloads)).toEqual({sessions: 5, users: 2})
        expect(aggregateSessionUsage([])).toEqual({sessions: 0, users: 0})
    })

    it('counts members per prefixed group', () => {
        const accounts = [
            {groups: [{prefix: 'passmower', name: 'admins'}, {prefix: 'github.com', name: 'devs'}]},
            {groups: [{prefix: 'passmower', name: 'admins'}]},
            {groups: []},
            {},
        ]
        expect(Object.fromEntries(countGroupMembers(accounts))).toEqual({
            'passmower:admins': 2,
            'github.com:devs': 1,
        })
    })

    describe('group membership gauge', () => {
        const gauge = {reset: vi.fn(), set: vi.fn()}

        beforeEach(() => {
            gauge.reset.mockClear()
            gauge.set.mockClear()
            globalThis.metrics = {groupMembers: gauge}
        })

        afterEach(() => {
            delete globalThis.metrics
        })

        it('is opt-in via METRICS_GROUP_MEMBERSHIP', () => {
            expect(groupMetricsEnabled({})).toBe(false)
            expect(groupMetricsEnabled({METRICS_GROUP_MEMBERSHIP: 'true'})).toBe(true)

            setGroupMembershipMetrics([{groups: [{prefix: 'p', name: 'g'}]}], {})
            expect(gauge.set).not.toHaveBeenCalled()
        })

        it('resets before setting so removed groups do not linger', () => {
            setGroupMembershipMetrics(
                [{groups: [{prefix: 'p', name: 'g'}]}],
                {METRICS_GROUP_MEMBERSHIP: 'true'},
            )
            expect(gauge.reset).toHaveBeenCalledOnce()
            expect(gauge.set).toHaveBeenCalledWith({group: 'p:g'}, 1)
        })
    })
})
