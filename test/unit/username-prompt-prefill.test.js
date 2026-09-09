import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'

// getUsernameSource memoises in module scope, so each case re-imports Account
// under a stubbed environment (same approach as username-source.test.js).
async function accountUnder(source) {
    vi.resetModules()
    vi.stubEnv('USERNAME_SOURCE', source)
    vi.stubEnv('ENROLL_USERS', 'true')
    return (await import('../../src/models/account.js')).default
}

const providerStub = () => ({
    interactionDetails: vi.fn().mockResolvedValue({result: {}}),
    interactionResult: vi.fn().mockResolvedValue(undefined),
})

// No existing user, so enrollment decides the username.
const ctxStub = () => ({
    req: {}, res: {}, headers: {},
    kubeOIDCUserService: {
        listUsers: vi.fn().mockResolvedValue([]),
        findUserByEmails: vi.fn().mockResolvedValue(undefined),
    },
})

// What the enter-username form is prefilled with: requireCustomUsername stashes
// preferredUsername in the interaction result, and enter-username.ejs renders it
// as the input's value.
const prefilledWith = (provider) => provider.interactionResult.mock.calls[0][2].preferredUsername

beforeEach(() => {
    globalThis.logger = {debug() {}, info() {}, warn() {}, error() {}, trace() {}}
})
afterEach(() => vi.unstubAllEnvs())

describe('USERNAME_SOURCE=prompt prefill', () => {
    it('suggests a sanitized username for an email-shaped upstream value', async () => {
        const Account = await accountUnder('prompt')
        const provider = providerStub()

        await Account.createOrUpdateByEmails(
            ctxStub(), provider, 'alice.smith@example.com', undefined, undefined,
            'alice.smith@example.com', {},
        )

        // Not the raw UPN, which breaks the length, alphanumeric, lowercase and
        // leading-letter rules and so could never be submitted as-is.
        expect(prefilledWith(provider)).toBe('alicesmith')
    })

    it('leaves an already-valid upstream username alone', async () => {
        const Account = await accountUnder('prompt')
        const provider = providerStub()

        await Account.createOrUpdateByEmails(
            ctxStub(), provider, 'alice@example.com', undefined, undefined, 'alice', {},
        )

        expect(prefilledWith(provider)).toBe('alice')
    })

    it('falls back to the raw value when nothing usable survives sanitizing', async () => {
        const Account = await accountUnder('prompt')
        const provider = providerStub()

        // Sanitizing yields null here (all digits are stripped as a leading run),
        // so there is no better suggestion to offer than what upstream said.
        await Account.createOrUpdateByEmails(
            ctxStub(), provider, '123@example.com', undefined, undefined, '123', {},
        )

        expect(prefilledWith(provider)).toBe('123')
    })

    it('matches what the upstream source already does when it cannot use the value', async () => {
        // USERNAME_SOURCE=upstream has always prefilled the sanitized candidate;
        // prompt now agrees, so the two paths suggest the same thing.
        const Account = await accountUnder('upstream')
        const provider = providerStub()
        const ctx = ctxStub()
        // Taken, so upstream cannot use it and falls through to the prompt form.
        ctx.kubeOIDCUserService.findUser = vi.fn().mockResolvedValue({accountId: 'alicesmith'})

        await Account.createOrUpdateByEmails(
            ctx, provider, 'alice.smith@example.com', undefined, undefined,
            'alice.smith@example.com', {},
        )

        expect(prefilledWith(provider)).toBe('alicesmith')
    })
})
