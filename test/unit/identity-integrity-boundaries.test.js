import {afterEach, beforeAll, describe, expect, it, vi} from 'vitest';
import Account from '../../src/models/account.js';
import {
    EmailLogin,
    recordMagicLinkVerification,
    recordSubmittedMagicLinkVerification,
} from '../../src/services/login/email-login.js';
import koaValidator, {checkIfEmailIsTaken} from '../../src/utils/session/validator.js';
import {IdentityIntegrityError} from '../../src/utils/user/identity-integrity.js';

beforeAll(() => {
    globalThis.logger ??= {info() {}, warn() {}, error() {}, debug() {}}
})

afterEach(() => vi.restoreAllMocks())

describe('identity-integrity error boundaries', () => {
    it('keeps the existing account when recording magic-link evidence fails', async () => {
        const account = {accountId: 'alice'}
        const service = {recordEmailVerification: vi.fn().mockResolvedValue(undefined)}

        await expect(recordMagicLinkVerification(
            service, account, 'alice@example.com', '2026-08-17T10:00:00.000Z',
        )).resolves.toBe(account)
        expect(service.recordEmailVerification).toHaveBeenCalledWith('alice', 'alice@example.com', {
            method: 'magic-link', provider: 'passmower', verifiedAt: '2026-08-17T10:00:00.000Z',
        })
    })

    it('records verified email submission after prompt-based user creation', async () => {
        const account = {accountId: 'alice'}
        const updated = {accountId: 'alice', verified: true}
        const service = {recordEmailVerification: vi.fn().mockResolvedValue(updated)}

        await expect(recordSubmittedMagicLinkVerification(service, account, {
            email: 'alice@example.com', emailVerified: true,
            emailVerifiedAt: '2026-08-17T10:00:00.000Z',
        })).resolves.toBe(updated)
        expect(service.recordEmailVerification).toHaveBeenCalledWith('alice', 'alice@example.com', {
            method: 'magic-link', provider: 'passmower', verifiedAt: '2026-08-17T10:00:00.000Z',
        })
    })

    it('renders access denied when magic-link lookup encounters a conflict', async () => {
        vi.spyOn(Account, 'findByEmail').mockRejectedValue(new IdentityIntegrityError('duplicate'))
        const login = Object.create(EmailLogin.prototype)
        const ctx = {req: {}, res: {}, headers: {}, request: {body: {email: 'duplicate@example.com'}}}
        const provider = {
            interactionDetails: vi.fn().mockResolvedValue({uid: 'interaction', params: {client_id: 'client'}}),
            Client: {find: vi.fn().mockResolvedValue({clientId: 'client'})},
            interactionFinished: vi.fn().mockResolvedValue('denied'),
        }

        await expect(login.sendLink(ctx, provider)).resolves.toBe('denied')
        expect(provider.interactionFinished).toHaveBeenCalledWith(ctx.req, ctx.res, {
            error: 'access_denied',
            error_description: 'This email is attached to a conflicted account. Contact an administrator.',
        }, {mergeWithLastSubmission: false})
    })

    it('reports a conflicted email as already taken during form validation', async () => {
        vi.spyOn(Account, 'findByEmail').mockRejectedValue(new IdentityIntegrityError('duplicate'))
        const ctx = {request: {body: {email: 'duplicate@example.com'}}}
        let errors

        await koaValidator()(ctx, async () => {
            checkIfEmailIsTaken(ctx)
            errors = await ctx.validationErrors()
        })

        expect(errors).toEqual([{
            param: 'email',
            msg: 'Email is already taken',
            value: 'duplicate@example.com',
        }])
    })
})
