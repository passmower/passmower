import {describe, expect, it} from 'vitest'
import Account from '../../src/models/account.js'
import {getAccountAccessFailure} from '../../src/utils/user/check-account-access.js'
import {buildPrivilegeDirectory} from '../../src/utils/user/privilege-directory.js'
import {OidcUserEventHook} from '../../src/models/oidc-user-event-hook.js'

const user = (extra = {}) => ({
    metadata: {name: 'alice', namespace: 'passmower', uid: 'uid-1', generation: 3, labels: {}},
    spec: {},
    status: {
        primaryEmail: 'alice@example.com',
        profile: {name: 'Alice'},
        groups: [{prefix: 'local', name: 'admins'}],
        conditions: [],
        termsOfService: {acceptedAt: '2026-08-21T10:00:00.000Z', contentHash: 'hash'},
    },
    ...extra,
})
const account = (extra) => new Account().fromKubernetes(user(extra))

// Offboarding stage (#73): the account is kept but nothing may be done as it.
describe('disabled accounts', () => {
    it('are disabled from the spec or from the admin panel section', () => {
        expect(account().disabled).toBe(false)
        expect(account({spec: {disabled: true}}).disabled).toBe(true)
        expect(account({passmower: {disabled: true}}).disabled).toBe(true)
        expect(account({spec: {disabled: false}, passmower: {disabled: false}}).disabled).toBe(false)
    })

    it('fail the access check every login, refresh and forward-auth path shares', () => {
        expect(getAccountAccessFailure({}, account())).toBeNull()
        expect(getAccountAccessFailure({}, account({spec: {disabled: true}}))).toBe('account_disabled')
        expect(getAccountAccessFailure({}, account({passmower: {disabled: true}}))).toBe('account_disabled')
    })

    it('tell the admin panel which switch disabled them', () => {
        expect(account({spec: {disabled: true}}).getProfileResponse(true))
            .toMatchObject({disabled: true, disabledBySpec: true, impersonationEnabled: false})
        expect(account({passmower: {disabled: true}}).getProfileResponse(true))
            .toMatchObject({disabled: true, disabledBySpec: false})
        expect(account().getProfileResponse(true)).toMatchObject({disabled: false})
        // Not part of the user's own profile response.
        expect(account({spec: {disabled: true}}).getProfileResponse()).not.toHaveProperty('disabled')
    })

    it('drop out of the privilege directory', () => {
        const directory = buildPrivilegeDirectory(
            [account(), account({metadata: {name: 'bob'}, spec: {disabled: true}})], ['local:admins'])
        expect(directory[0].members.map(member => member.username)).toEqual(['alice'])
    })

    it('are reported to lifecycle hook Jobs', () => {
        const hook = new OidcUserEventHook().fromKubernetes({
            metadata: {name: 'offboard', namespace: 'passmower', uid: 'hook-uid'},
            spec: {events: ['Modified'], jobSpec: {template: {spec: {containers: [{name: 'c', image: 'i'}]}}}},
        })
        const env = (resource) => Object.fromEntries(
            hook.getJob({type: 'Modified', user: resource}).spec.template.spec.containers[0].env
                .map(({name, value}) => [name, value]))
        expect(env(user()).PASSMOWER_RESOURCE_DISABLED).toBe('false')
        expect(env(user({spec: {disabled: true}})).PASSMOWER_RESOURCE_DISABLED).toBe('true')
        expect(env(user({passmower: {disabled: true}})).PASSMOWER_RESOURCE_DISABLED).toBe('true')
    })
})
