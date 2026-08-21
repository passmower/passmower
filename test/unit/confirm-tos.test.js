import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'
import crypto from 'node:crypto'

const contentHash = crypto.createHash('sha256').update('Terms', 'utf8').digest('hex')

const mocks = vi.hoisted(() => ({sendMail: vi.fn(), terms: 'Terms'}))

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

vi.mock('../../src/utils/get-text.js', () => ({getTermsOfService: () => mocks.terms}))

import Account from '../../src/models/account.js'
import {confirmTos} from '../../src/utils/user/confirm-tos.js'

beforeEach(() => {
    vi.stubEnv('EMAIL_ENABLED', 'true')
    mocks.terms = 'Terms'
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

        await confirmTos({headers: {}, kubeOIDCUserService: {mutateUserStatus}}, 'alice', contentHash)

        expect(account.acceptTermsOfService).toHaveBeenCalledWith(contentHash, expect.any(Date))
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

        await confirmTos({headers: {}, kubeOIDCUserService: {mutateUserStatus}}, 'alice', contentHash)

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
            {headers: {}, kubeOIDCUserService: {mutateUserStatus}}, 'alice', contentHash,
        )).resolves.toBe(true)
        expect(account.acceptTermsOfService).toHaveBeenCalled()
    })

    it('rejects acceptance when the document changed after the prompt was rendered', async () => {
        await expect(confirmTos(
            {headers: {}, kubeOIDCUserService: {}}, 'alice', 'stale-hash',
        )).rejects.toThrow('Terms of Service changed during acceptance')
        expect(mocks.sendMail).not.toHaveBeenCalled()
    })

    it('does not record acceptance or send a receipt when ToS is unconfigured', async () => {
        mocks.terms = null
        const findAccount = vi.spyOn(Account, 'findAccount')

        await expect(confirmTos(
            {headers: {}, kubeOIDCUserService: {}}, 'alice', contentHash,
        )).resolves.toBe(false)
        expect(findAccount).not.toHaveBeenCalled()
        expect(mocks.sendMail).not.toHaveBeenCalled()
    })
})
