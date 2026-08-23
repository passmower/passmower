import {afterEach, describe, expect, it, vi} from 'vitest';
import Account from '../../src/models/account.js';
import {assessEmailOwnership, canonicalizeEmail} from '../../src/utils/user/identity-integrity.js';

function account(name, created, email) {
    return new Account().fromKubernetes({
        metadata: {name, creationTimestamp: created},
        spec: {email, type: 'person'},
        status: {},
    })
}

afterEach(() => vi.unstubAllEnvs())

describe('email identity integrity', () => {
    it('always trims and lowercases email addresses', () => {
        expect(canonicalizeEmail(' Alice@Example.COM ')).toBe('alice@example.com')
    })

    it('applies configured provider-specific normalization consistently', () => {
        vi.stubEnv('NORMALIZE_EMAIL_ADDRESSES', 'true')
        expect(canonicalizeEmail('alice+alias@gmail.com')).toBe('alice@gmail.com')
    })

    it('selects the earliest resource as owner independent of list order', () => {
        const original = account('original', '2026-01-01T00:00:00Z', 'same@example.com')
        const duplicate = account('duplicate', '2026-02-01T00:00:00Z', 'SAME@example.com')
        const ownership = assessEmailOwnership([duplicate, original])

        expect(ownership.owners.get('same@example.com').accountId).toBe('original')
        expect(ownership.conflicts.get('duplicate')).toEqual([{
            email: 'same@example.com', ownerAccountId: 'original',
        }])
    })
})
