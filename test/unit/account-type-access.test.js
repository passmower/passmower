import {describe, expect, it} from 'vitest'
import {
    canImpersonateAccount,
    getAccountTypeAccessFailure,
} from '../../src/utils/user/account-type-access.js'

const account = type => ({type})

describe('account type access', () => {
    it.each([undefined, null, 'person'])('allows %s accounts to log in normally', type => {
        expect(getAccountTypeAccessFailure(account(type))).toBeNull()
    })

    it.each(['service', 'org', 'group', 'unexpected'])(
        'rejects %s accounts from ordinary login', type => {
            expect(getAccountTypeAccessFailure(account(type)))
                .toBe('account_type_not_login_capable')
        },
    )

    it('reports banned accounts distinctly without allowing impersonation', () => {
        expect(getAccountTypeAccessFailure(account('banned'))).toBe('account_banned')
        expect(canImpersonateAccount(account('banned'))).toBe(false)
    })

    it('allows only people, legacy accounts, and services to be impersonated', () => {
        for (const type of [undefined, null, 'person', 'service']) {
            expect(canImpersonateAccount(account(type))).toBe(true)
        }
        for (const type of ['banned', 'org', 'group', 'unexpected']) {
            expect(canImpersonateAccount(account(type))).toBe(false)
        }
    })

    it('treats a missing account as unavailable', () => {
        expect(getAccountTypeAccessFailure(null)).toBe('account_missing')
    })
})
