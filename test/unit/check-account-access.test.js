import {afterEach, describe, expect, it, vi} from 'vitest'
import Account from '../../src/models/account.js'
import {getAccountAccessFailure} from '../../src/utils/user/check-account-access.js'

const account = ({name = 'Alice', groups = [], terms = true, type} = {}) => new Account().fromKubernetes({
    metadata: {name: 'alice', labels: {}},
    spec: type ? {type} : {},
    status: {
        profile: {name},
        groups: groups.map(displayName => {
            const [prefix, ...rest] = displayName.split(':')
            return {prefix, name: rest.join(':')}
        }),
        conditions: [],
        termsOfService: terms ? {
            acceptedAt: '2026-08-21T10:00:00.000Z', contentHash: 'hash',
        } : undefined,
    },
})

afterEach(() => vi.unstubAllEnvs())

describe('current account access policy', () => {
    const termsOfService = {text: 'Terms', contentHash: 'hash'}

    it('accepts an unchanged eligible account', () => {
        expect(getAccountAccessFailure({}, account(), termsOfService)).toBeNull()
    })

    it('rejects missing accounts, profile data, ToS, and client membership', () => {
        expect(getAccountAccessFailure({}, null)).toBe('account_missing')
        expect(getAccountAccessFailure({}, account({name: null}))).toBe('name_required')
        expect(getAccountAccessFailure({}, account({terms: false}), termsOfService)).toBe('tos_required')
        expect(getAccountAccessFailure({allowedGroups: ['local:staff']}, account()))
            .toBe('client_access_required')
    })

    it('rechecks global approval against current groups', () => {
        vi.stubEnv('REQUIRED_GROUP', 'local:staff')
        expect(getAccountAccessFailure({}, account())).toBe('approval_required')
        expect(getAccountAccessFailure({}, account({groups: ['local:staff']}))).toBeNull()

        const admin = account()
        admin.isAdmin = true
        expect(getAccountAccessFailure({}, admin)).toBeNull()
    })

    it('rejects an account that accepted a different ToS version', () => {
        expect(getAccountAccessFailure({}, account(), {
            text: 'Updated terms', contentHash: 'updated-hash',
        })).toBe('tos_required')
    })

    it.each([
        ['banned', 'account_banned'],
        ['service', 'account_type_not_login_capable'],
        ['org', 'account_type_not_login_capable'],
        ['group', 'account_type_not_login_capable'],
    ])('rejects %s accounts before other policy checks', (type, failure) => {
        expect(getAccountAccessFailure({}, account({type}), termsOfService)).toBe(failure)
    })
})
