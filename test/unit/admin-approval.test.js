import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'

// GroupPrefix is read at module load, so each case re-imports under a stubbed
// environment (the pattern username-source.test.js uses).
async function withGroups({groupPrefix = 'passmower', requiredGroup = ''} = {}) {
    vi.resetModules()
    vi.stubEnv('GROUP_PREFIX', groupPrefix)
    vi.stubEnv('REQUIRED_GROUP', requiredGroup)
    const {default: Account} = await import('../../src/models/account.js')
    const {Approved} = await import('../../src/conditions/approved.js')
    return {Account, Approved}
}

const user = (Account, {groups = [], passmower = {}} = {}) => new Account().fromKubernetes({
    metadata: {name: 'alice', labels: {}},
    spec: {},
    passmower,
    status: {
        profile: {name: 'Alice'},
        groups: groups.map(displayName => {
            const [prefix, ...rest] = displayName.split(':')
            return {prefix, name: rest.join(':')}
        }),
        conditions: [],
        termsOfService: {acceptedAt: '2026-08-21T10:00:00.000Z', contentHash: 'hash'},
    },
})

beforeEach(() => {
    globalThis.logger = {debug() {}, info() {}, warn: vi.fn(), error() {}, trace() {}}
})
afterEach(() => vi.unstubAllEnvs())

describe('approving against an upstream REQUIRED_GROUP', () => {
    // The reported case: the required group is synced from a directory, so it
    // cannot be granted locally — approving used to write passmower:employees
    // and report success while the check kept failing against entraid:employees.
    const upstream = {groupPrefix: 'passmower', requiredGroup: 'entraid:employees'}

    it('makes the account pass the check it exists to satisfy', async () => {
        const {Account, Approved} = await withGroups(upstream)
        const account = user(Account)
        expect(new Approved().check(account)).toBe(false)

        new Approved().add(account)

        expect(new Approved().check(account)).toBe(true)
    })

    it('never writes the upstream group onto the account', async () => {
        const {Account, Approved} = await withGroups(upstream)
        const account = user(Account)

        new Approved().add(account)

        // Local groups are merged into status.groups and from there into the
        // groups claim and other clients' allowedGroups checks, so a forged
        // entraid:employees would be indistinguishable from real membership.
        expect(account.getSpecs().passmower.groups ?? []).toEqual([])
        expect(account.getSpecs().passmower.approved).toBe(true)
    })

    it('persists through the specs the admin routes write', async () => {
        const {Account, Approved} = await withGroups(upstream)
        const account = user(Account)

        new Approved().add(account)

        // Account.approve() hands getSpecs() to updateUserSpecs, so anything
        // outside that projection would be silently dropped.
        expect(account.getSpecs()).toMatchObject({passmower: {approved: true}})
    })
})

describe('approving against a local REQUIRED_GROUP', () => {
    const local = {groupPrefix: 'passmower', requiredGroup: 'passmower:staff'}

    it('still grants the group, so clients gating on it keep working', async () => {
        const {Account, Approved} = await withGroups(local)
        const account = user(Account)

        new Approved().add(account)

        expect(account.getSpecs().passmower.groups).toEqual([{prefix: 'passmower', name: 'staff'}])
        expect(new Approved().check(account)).toBe(true)
    })

    it('accepts an account that is already in the group, without approval', async () => {
        const {Account, Approved} = await withGroups(local)

        expect(new Approved().check(user(Account, {groups: ['passmower:staff']}))).toBe(true)
    })
})

describe('the approval check', () => {
    it('passes everyone when no group is required', async () => {
        const {Account, Approved} = await withGroups({requiredGroup: ''})

        expect(new Approved().check(user(Account))).toBe(true)
    })

    it('accepts membership of the required group or of ADMIN_GROUP', async () => {
        vi.stubEnv('ADMIN_GROUP', 'entraid:platform')
        const {Account, Approved} = await withGroups({requiredGroup: 'entraid:employees'})

        expect(new Approved().check(user(Account, {groups: ['entraid:employees']}))).toBe(true)
        expect(new Approved().check(user(Account, {groups: ['entraid:platform']}))).toBe(true)
        expect(new Approved().check(user(Account, {groups: ['entraid:contractors']}))).toBe(false)
    })

    it('reports a boolean rather than the matched group', async () => {
        // getProfileResponse() puts this straight in an API response.
        const {Account, Approved} = await withGroups({requiredGroup: 'entraid:employees'})

        expect(new Approved().check(user(Account, {groups: ['entraid:employees']}))).toBe(true)
    })

    it('recognises an approval recorded on the resource', async () => {
        // GitOps: an operator can set spec.passmower.approved directly.
        const {Account, Approved} = await withGroups({requiredGroup: 'entraid:employees'})

        expect(new Approved().check(user(Account, {passmower: {approved: true}}))).toBe(true)
    })
})

describe('group configuration validation', () => {
    it('warns about a value that cannot match any group', async () => {
        const {validateGroupConfiguration} = await import('../../src/utils/group-configuration.js')

        expect(validateGroupConfiguration({REQUIRED_GROUP: 'employees'})).toEqual([
            'REQUIRED_GROUP="employees" has no "<prefix>:<name>" prefix, so it matches no group',
        ])
        expect(validateGroupConfiguration({ADMIN_GROUP: 'admins'})).toHaveLength(1)
        expect(validateGroupConfiguration({REQUIRED_GROUP: 'admins', ADMIN_GROUP: 'admins'}))
            .toHaveLength(2)
    })

    it('accepts prefixed values and absent ones', async () => {
        const {validateGroupConfiguration} = await import('../../src/utils/group-configuration.js')

        expect(validateGroupConfiguration({
            REQUIRED_GROUP: 'entraid:employees', ADMIN_GROUP: 'passmower:admins',
        })).toEqual([])
        expect(validateGroupConfiguration({})).toEqual([])
        expect(validateGroupConfiguration({REQUIRED_GROUP: ''})).toEqual([])
    })

    it('warns rather than throwing, so a misconfigured install still boots', async () => {
        const {validateGroupConfiguration} = await import('../../src/utils/group-configuration.js')
        const logger = {warn: vi.fn()}

        expect(() => validateGroupConfiguration({ADMIN_GROUP: 'admins'}, logger)).not.toThrow()
        expect(logger.warn).toHaveBeenCalledTimes(1)
    })
})
