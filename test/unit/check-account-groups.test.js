import { describe, it, expect } from 'vitest'
import Account from '../../src/models/account.js'
import { checkAccountGroups } from '../../src/utils/user/check-account-groups.js'

function accountWithGroups(groups, name = 'u') {
    return new Account().fromKubernetes({ metadata: { name, labels: {} }, status: { groups } })
}

describe('checkAccountGroups', () => {
    const account = accountWithGroups([{ prefix: 'gh', name: 'org' }, { prefix: 'local', name: 'team' }])

    it('allows when the client restricts to no groups', () => {
        expect(checkAccountGroups({}, account)).toBe(true)
        expect(checkAccountGroups({ allowedGroups: [] }, account)).toBe(true)
    })

    it('allows when the account is in at least one allowed group', () => {
        expect(checkAccountGroups({ allowedGroups: ['gh:org'] }, account)).toBe(true)
        expect(checkAccountGroups({ allowedGroups: ['x:y', 'local:team'] }, account)).toBe(true)
    })

    it('denies when the account is in none of the allowed groups', () => {
        expect(checkAccountGroups({ allowedGroups: ['x:y'] }, account)).toBe(false)
    })

    it('allows an explicitly listed account', () => {
        expect(checkAccountGroups({allowedUsers: ['u']}, account)).toBe(true)
        expect(checkAccountGroups({allowedUsers: ['someone-else']}, account)).toBe(false)
    })

    it('combines user and group allowlists using OR semantics', () => {
        expect(checkAccountGroups({
            allowedUsers: ['someone-else'],
            allowedGroups: ['local:team'],
        }, account)).toBe(true)
        expect(checkAccountGroups({
            allowedUsers: ['u'],
            allowedGroups: ['x:y'],
        }, account)).toBe(true)
        expect(checkAccountGroups({
            allowedUsers: ['someone-else'],
            allowedGroups: ['x:y'],
        }, account)).toBe(false)
    })
})
