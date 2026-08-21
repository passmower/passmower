import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'

const mocks = vi.hoisted(() => ({
    createTransport: vi.fn(),
    sendMail: vi.fn(),
}))

vi.mock('nodemailer', () => ({
    default: {
        createTransport: mocks.createTransport,
    },
}))

import EmailAdapter from '../../src/adapters/email.js'

beforeEach(() => {
    mocks.sendMail.mockReset().mockResolvedValue({messageId: 'sent'})
    mocks.createTransport.mockReset().mockReturnValue({sendMail: mocks.sendMail})
})

afterEach(() => vi.unstubAllEnvs())

describe('EmailAdapter', () => {
    it('does not initialize Nodemailer when email is disabled', async () => {
        vi.stubEnv('EMAIL_ENABLED', 'false')
        await expect(new EmailAdapter().sendMail('a@example.com', 'subject', 'text', 'html'))
            .rejects.toThrow('Email delivery is disabled')
        expect(mocks.createTransport).not.toHaveBeenCalled()
    })

    it('initializes lazily and propagates transport failures when enabled', async () => {
        for (const [key, value] of Object.entries({
            EMAIL_ENABLED: 'true', EMAIL_HOST: 'smtp.example.com', EMAIL_PORT: '587',
            EMAIL_SSL: 'false', EMAIL_USERNAME: 'passmower', EMAIL_PASSWORD: 'secret',
        })) vi.stubEnv(key, value)
        mocks.sendMail.mockRejectedValueOnce(new Error('SMTP unavailable'))
        const adapter = new EmailAdapter()

        expect(mocks.createTransport).not.toHaveBeenCalled()
        await expect(adapter.sendMail('a@example.com', 'subject', 'text', 'html'))
            .rejects.toThrow('SMTP unavailable')
        expect(mocks.createTransport).toHaveBeenCalledOnce()
    })
})
