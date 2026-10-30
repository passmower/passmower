import {afterEach, beforeAll, beforeEach, describe, expect, it, vi} from 'vitest'
import Account from '../../src/models/account.js'
import {KubeOIDCUserService} from '../../src/services/kube-oidc-user-service.js'
import {FakeKubernetesAdapter} from '../fakes/fake-kubernetes-adapter.js'

// A login from an upstream identity Passmower has not seen links to an existing
// account by email only through an address whose control is proven; otherwise
// anyone who can set that address at the upstream takes the account over.
describe('linking a login to an existing account by email', () => {
    let adapter
    let ctx
    let provider

    beforeAll(() => {
        globalThis.logger ??= {info() {}, warn() {}, error() {}, debug() {}}
    })

    beforeEach(() => {
        vi.stubEnv('ENROLL_USERS', 'false')
        adapter = new FakeKubernetesAdapter()
        adapter.seed('OIDCUser', {
            metadata: {name: 'alice', creationTimestamp: '2026-01-01T00:00:00Z', uid: 'uid-alice'},
            spec: {type: 'person', email: 'alice@example.com'},
            identities: {dex: {sub: 'alice-sub', emails: [{email: 'alice@example.com', primary: true}]}},
            status: {},
        })
        ctx = {req: {}, res: {}, headers: {}, kubeOIDCUserService: new KubeOIDCUserService(adapter)}
        provider = {
            interactionDetails: vi.fn().mockResolvedValue({result: {}}),
            interactionResult: vi.fn().mockResolvedValue(undefined),
        }
    })

    afterEach(() => vi.unstubAllEnvs())

    const oidcLogin = (sub, verified, providerKey = 'entra') => Account.createOrUpdateByEmails(
        ctx, provider, 'Alice@Example.com',
        [{email: 'Alice@Example.com', primary: true, verified}],
        undefined, 'mallory', {providerKey, subject: sub},
    )
    const refusal = () => provider.interactionResult.mock.calls.at(-1)?.[2]

    it.each([undefined, false])('refuses a new OIDC identity whose matching email is %s', async (verified) => {
        await expect(oidcLogin('mallory-sub', verified)).resolves.toBeUndefined()
        expect(refusal()).toEqual({
            error: 'access_denied',
            error_description: expect.stringContaining('did not verify it'),
        })
        expect(adapter.list('OIDCUser').find(u => u.metadata.name === 'alice').identities.entra).toBeUndefined()
    })

    it('links a new OIDC identity through a verified email', async () => {
        expect((await oidcLogin('alice-entra-sub', true))?.accountId).toBe('alice')
        expect(provider.interactionResult).not.toHaveBeenCalled()
    })

    it('keeps signing in an already-linked identity whose email is unverified', async () => {
        expect((await oidcLogin('alice-sub', undefined, 'dex'))?.accountId).toBe('alice')
        expect(provider.interactionResult).not.toHaveBeenCalled()
    })

    it('links a magic-link login, whose address Passmower verified', async () => {
        expect((await Account.createOrUpdateByEmails(ctx, provider, 'alice@example.com'))?.accountId).toBe('alice')
    })

    it('links a GitHub login through its verified addresses', async () => {
        const account = await Account.createOrUpdateByEmails(
            ctx, provider, undefined, [{email: 'alice@example.com', primary: true, verified: true}],
            undefined, 'alice-gh', {githubId: 42},
        )
        expect(account?.accountId).toBe('alice')
    })

    it('leaves an unverified email that matches no account to enrollment', async () => {
        await Account.createOrUpdateByEmails(
            ctx, provider, 'new@example.com', [{email: 'new@example.com', primary: true}],
            undefined, 'newbie', {providerKey: 'entra', subject: 'new-sub'},
        )
        expect(provider.interactionResult).not.toHaveBeenCalled()
    })
})
