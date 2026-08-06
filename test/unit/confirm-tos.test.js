import {afterEach, describe, expect, it, vi} from 'vitest'

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

afterEach(() => vi.restoreAllMocks())

describe('confirmTos', () => {
    it('persists dedicated acceptance state before sending confirmation email', async () => {
        const account = {
            profile: {name: 'Alice'},
            primaryEmail: 'alice@example.com',
            acceptTermsOfService: vi.fn(),
        }
        vi.spyOn(Account, 'findAccount').mockResolvedValue(account)
        const updateUserStatus = vi.fn()

        await confirmTos({kubeOIDCUserService: {updateUserStatus}}, 'alice', 'content-hash')

        expect(account.acceptTermsOfService).toHaveBeenCalledWith('content-hash', expect.any(Date))
        expect(updateUserStatus).toHaveBeenCalledWith(account)
        expect(mocks.sendMail).toHaveBeenCalledWith(
            'alice@example.com', 'Terms accepted', 'text', '<p>html</p>',
        )
    })
})
