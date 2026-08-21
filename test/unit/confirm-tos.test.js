import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'

const mocks = vi.hoisted(() => ({sendMail: vi.fn()}))

vi.mock('../../src/adapters/email.js', () => ({
    default: class EmailAdapter {
        sendMail(...args) {
            return mocks.sendMail(...args)
        }
    },
}))

vi.mock('../../src/utils/get-email-content.js', () => ({
    getEmailContent: vi.fn().mockResolvedValue({text: 'text', html: '<p>html</p>'}),
    getEmailSubject: vi.fn().mockReturnValue('Terms accepted'),
}))

vi.mock('../../src/utils/get-text.js', () => ({
    getText: vi.fn().mockReturnValue('Terms'),
    ToSTextName: 'termsOfService',
}))

import Account from '../../src/models/account.js'
import {confirmTos} from '../../src/utils/user/confirm-tos.js'

beforeEach(() => {
    vi.stubEnv('EMAIL_ENABLED', 'true')
    mocks.sendMail.mockReset().mockResolvedValue({})
    globalThis.logger ??= {info() {}, error() {}}
})

afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllEnvs()
})

describe('confirmTos', () => {
    it('persists dedicated acceptance state before sending confirmation email', async () => {
        const account = {
            profile: {name: 'Alice'},
            primaryEmail: 'alice@example.com',
            acceptTermsOfService: vi.fn(),
        }
        vi.spyOn(Account, 'findAccount').mockResolvedValue(account)
        const mutateUserStatus = vi.fn(async (_accountId, mutation) => mutation(account))

        await confirmTos({headers: {}, kubeOIDCUserService: {mutateUserStatus}}, 'alice', 'content-hash')

        expect(account.acceptTermsOfService).toHaveBeenCalledWith('content-hash', expect.any(Date))
        expect(mutateUserStatus).toHaveBeenCalledWith('alice', expect.any(Function))
        expect(mocks.sendMail).toHaveBeenCalledWith(
            'alice@example.com', 'Terms accepted', 'text', '<p>html</p>',
        )
    })

    it('persists acceptance without constructing a receipt when email is disabled', async () => {
        vi.stubEnv('EMAIL_ENABLED', 'false')
        const account = {
            profile: {name: 'Alice'}, primaryEmail: undefined,
            acceptTermsOfService: vi.fn(),
        }
        vi.spyOn(Account, 'findAccount').mockResolvedValue(account)
        const mutateUserStatus = vi.fn(async (_accountId, mutation) => mutation(account))

        await confirmTos({headers: {}, kubeOIDCUserService: {mutateUserStatus}}, 'alice', 'content-hash')

        expect(account.acceptTermsOfService).toHaveBeenCalled()
        expect(mocks.sendMail).not.toHaveBeenCalled()
    })

    it('does not roll back acceptance when receipt delivery fails', async () => {
        const account = {
            profile: {name: 'Alice'}, primaryEmail: 'alice@example.com',
            acceptTermsOfService: vi.fn(),
        }
        vi.spyOn(Account, 'findAccount').mockResolvedValue(account)
        mocks.sendMail.mockRejectedValueOnce(new Error('SMTP unavailable'))
        const mutateUserStatus = vi.fn(async (_accountId, mutation) => mutation(account))

        await expect(confirmTos(
            {headers: {}, kubeOIDCUserService: {mutateUserStatus}}, 'alice', 'content-hash',
        )).resolves.toBeUndefined()
        expect(account.acceptTermsOfService).toHaveBeenCalled()
    })
})
