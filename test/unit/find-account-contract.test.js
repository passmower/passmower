import {describe, expect, it, vi} from 'vitest'
import configuration from '../../src/configuration.js'
import Account from '../../src/models/account.js'

// oidc-provider type-checks what findAccount resolves with
// (helpers/configuration_result.js `account()`): undefined, or an object with a
// non-empty accountId and a claims function. Anything else — null included — is
// a TypeError, which reaches the client as a 500 instead of invalid_grant.
//
// 9.11 only checked truthiness, so returning null worked by accident, and 9.12
// turned two of our returns into 500s on the refresh-token deny paths. These
// assertions are about the *type*, so `toBeUndefined` is the point: do not
// relax them to `toBeFalsy`.

const eligibleAccount = () => new Account().fromKubernetes({
    metadata: {name: 'alice', labels: {}},
    spec: {},
    status: {
        profile: {name: 'Alice'},
        groups: [],
        conditions: [],
        termsOfService: {acceptedAt: '2026-08-21T10:00:00.000Z', contentHash: 'hash'},
    },
})

// `headers` is what auditLog reads off the koa context on the deny path.
const ctxFor = (user, client = {}) => ({
    kubeOIDCUserService: {findUser: vi.fn().mockResolvedValue(user)},
    oidc: {client},
    headers: {},
})

describe('findAccount return contract', () => {
    it('resolves undefined, never null, for an account that no longer exists', async () => {
        globalThis.logger = {debug() {}, info() {}, warn() {}, error() {}, trace() {}}
        const ctx = ctxFor(undefined)

        await expect(Account.findAccount(ctx, 'gone')).resolves.toBeUndefined()
        await expect(configuration.findAccount(ctx, 'gone', {kind: 'RefreshToken'}))
            .resolves.toBeUndefined()
    })

    it('resolves undefined when a refresh token no longer satisfies account access', async () => {
        globalThis.logger = {debug() {}, info() {}, warn() {}, error() {}, trace() {}}
        // Eligible account, but the client now demands a group it lacks.
        const ctx = ctxFor(eligibleAccount(), {allowedGroups: ['local:staff'], clientId: 'app'})

        await expect(configuration.findAccount(ctx, 'alice', {kind: 'RefreshToken'}))
            .resolves.toBeUndefined()
    })

    it('still returns the account when access holds, and for non-refresh lookups', async () => {
        const ctx = ctxFor(eligibleAccount())

        await expect(configuration.findAccount(ctx, 'alice', {kind: 'RefreshToken'}))
            .resolves.toMatchObject({accountId: 'alice'})
        // An authorization-endpoint lookup passes no token and skips the recheck.
        await expect(configuration.findAccount(ctx, 'alice', undefined))
            .resolves.toMatchObject({accountId: 'alice'})
    })

    it('returns something oidc-provider accepts as an account', async () => {
        const account = await configuration.findAccount(ctxFor(eligibleAccount()), 'alice', undefined)

        expect(typeof account.accountId).toBe('string')
        expect(account.accountId.length).toBeGreaterThan(0)
        expect(typeof account.claims).toBe('function')
    })
})
