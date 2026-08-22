import {beforeEach, describe, expect, it, vi} from 'vitest'
import {
    impersonationNotificationsEnabled,
    loginNotificationsEnabled,
    notifyAccount,
} from '../../src/services/notification-service.js'

const account = {accountId: 'alice', primaryEmail: 'alice@example.com', slackId: 'U123'}

describe('notification service', () => {
    let emailAdapter, slackAdapter

    beforeEach(() => {
        globalThis.logger = {info: vi.fn(), warn: vi.fn(), error: vi.fn()}
        emailAdapter = {sendMail: vi.fn().mockResolvedValue({})}
        slackAdapter = {sendMessage: vi.fn().mockResolvedValue({})}
    })

    it('gates each event on its own flag with the intended defaults', () => {
        expect(loginNotificationsEnabled({})).toBe(false)
        expect(loginNotificationsEnabled({NOTIFY_ON_LOGIN: 'true'})).toBe(true)
        expect(impersonationNotificationsEnabled({})).toBe(true)
        expect(impersonationNotificationsEnabled({NOTIFY_ON_IMPERSONATION: 'false'})).toBe(false)
    })

    it('broadcasts to every channel the account has', async () => {
        await notifyAccount(account, 'Subject', 'Body',
            {emailAdapter, slackAdapter, env: {SLACK_TOKEN: 'token'}})

        expect(emailAdapter.sendMail).toHaveBeenCalledWith('alice@example.com', 'Subject', 'Body')
        expect(slackAdapter.sendMessage).toHaveBeenCalledWith('U123', '*Subject*\nBody')
    })

    it('skips channels the account or deployment does not have', async () => {
        await notifyAccount({accountId: 'bob', slackId: 'U9'}, 'S', 'B',
            {emailAdapter, slackAdapter, env: {SLACK_TOKEN: 'token'}})
        expect(emailAdapter.sendMail).not.toHaveBeenCalled()
        expect(slackAdapter.sendMessage).toHaveBeenCalled()

        slackAdapter.sendMessage.mockClear()
        await notifyAccount(account, 'S', 'B',
            {emailAdapter, slackAdapter, env: {EMAIL_ENABLED: 'false'}})
        expect(slackAdapter.sendMessage).not.toHaveBeenCalled()

        await expect(notifyAccount(undefined, 'S', 'B', {emailAdapter, slackAdapter, env: {}}))
            .resolves.toBeUndefined()
    })

    it('never rejects when a channel fails, only logs', async () => {
        emailAdapter.sendMail.mockRejectedValue(new Error('smtp down'))
        slackAdapter.sendMessage.mockRejectedValue(new Error('slack down'))

        await expect(notifyAccount(account, 'S', 'B',
            {emailAdapter, slackAdapter, env: {SLACK_TOKEN: 'token'}})).resolves.toBeUndefined()
        expect(globalThis.logger.warn).toHaveBeenCalledTimes(2)
    })
})
