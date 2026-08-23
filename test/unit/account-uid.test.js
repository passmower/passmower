import { describe, it, expect } from 'vitest'
import Account from '../../src/models/account.js'

// Regression for #13: getUid() used ShortUniqueId.stamp(), which embeds the
// creation timestamp and leaves only a couple of random characters — so
// same-millisecond signups could collide and the creation time leaked from the
// id. It now uses a fully random id.
describe('Account.getUid (#13)', () => {
    it('produces a u-prefixed, 11-char lowercase-alphanumeric id', () => {
        const id = Account.getUid()
        expect(id).toMatch(/^u[a-z0-9]{10}$/)
    })

    it('does not collide across many same-tick generations', () => {
        const ids = new Set()
        for (let i = 0; i < 5000; i++) ids.add(Account.getUid())
        expect(ids.size).toBe(5000)
    })

    it('is not timestamp-ordered (random, not a stamp)', () => {
        // stamp()-based ids share a long common prefix when generated together;
        // random ids do not. Assert the first random char varies across a batch.
        const firstRandomChars = new Set(
            Array.from({ length: 50 }, () => Account.getUid()[1])
        )
        expect(firstRandomChars.size).toBeGreaterThan(1)
    })
})
