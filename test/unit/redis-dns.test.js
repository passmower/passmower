import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// Mock node:dns/promises before importing the adapter so resolveHostIps picks
// up the fake. The adapter imports the default export and calls dns.lookup().
const { lookup } = vi.hoisted(() => ({ lookup: vi.fn() }))
vi.mock('node:dns/promises', () => ({ default: { lookup } }))

const { resolveHostIps } = await import('../../src/adapters/redis.js')

describe('resolveHostIps — IP-family-aware Redis DNS watcher', () => {
    beforeEach(() => {
        lookup.mockReset()
        delete process.env.REDIS_IP_FAMILY
    })
    afterEach(() => {
        delete process.env.REDIS_IP_FAMILY
    })

    it('queries the requested family (6) instead of IPv4-only A records', async () => {
        lookup.mockResolvedValue([{ address: '2001:db8::1', family: 6 }])

        const ips = await resolveHostIps('redis.passmower.svc.cluster.local', 6)

        expect(lookup).toHaveBeenCalledWith('redis.passmower.svc.cluster.local', { all: true, family: 6 })
        expect(ips).toEqual(['2001:db8::1'])
    })

    it('returns a sorted list of addresses so change detection is stable', async () => {
        lookup.mockResolvedValue([
            { address: '10.0.0.2', family: 4 },
            { address: '10.0.0.1', family: 4 },
        ])

        expect(await resolveHostIps('redis', 4)).toEqual(['10.0.0.1', '10.0.0.2'])
    })

    it('defaults the family from REDIS_IP_FAMILY', async () => {
        process.env.REDIS_IP_FAMILY = '6'
        lookup.mockResolvedValue([{ address: '2001:db8::2', family: 6 }])

        await resolveHostIps('redis')

        expect(lookup).toHaveBeenCalledWith('redis', { all: true, family: 6 })
    })

    it('defaults to family 0 (both) when REDIS_IP_FAMILY is unset', async () => {
        lookup.mockResolvedValue([{ address: '10.0.0.1', family: 4 }])

        await resolveHostIps('redis')

        expect(lookup).toHaveBeenCalledWith('redis', { all: true, family: 0 })
    })
})
