import {beforeEach, describe, expect, it, vi} from 'vitest'
import requestErrorHandler from '../../src/utils/request-error-handler.js'

describe('requestErrorHandler', () => {
    beforeEach(() => {
        globalThis.logger = {error: vi.fn(), debug: vi.fn()}
    })

    it('renders a safe HTML response for an unhandled request error', async () => {
        const ctx = {method: 'GET', path: '/profile'}
        const error = new Error('redis password was hunter2')

        await requestErrorHandler(ctx, async () => {
            throw error
        })

        expect(ctx.status).toBe(500)
        expect(ctx.type).toBe('html')
        expect(ctx.body).toContain('server_error')
        expect(ctx.body).toContain('An unexpected error occurred')
        expect(ctx.body).not.toContain(error.message)
        expect(globalThis.logger.error).toHaveBeenCalledWith({
            error,
            method: 'GET',
            path: '/profile',
        }, 'Unhandled request error')
    })

    it('does not replace a response after its headers were sent', async () => {
        const ctx = {headerSent: true}
        const error = new Error('stream failed')

        await expect(requestErrorHandler(ctx, async () => {
            throw error
        })).rejects.toBe(error)

        expect(ctx.body).toBeUndefined()
        expect(globalThis.logger.error).not.toHaveBeenCalled()
    })

    it('leaves intentional client errors to Koa', async () => {
        const ctx = {method: 'GET', path: '/interaction/id/passkey/start'}
        const error = Object.assign(new Error('Passkey login is disabled'), {
            status: 404,
            expose: true,
        })

        await expect(requestErrorHandler(ctx, async () => {
            throw error
        })).rejects.toBe(error)

        expect(ctx.status).toBeUndefined()
        expect(ctx.body).toBeUndefined()
        expect(globalThis.logger.error).not.toHaveBeenCalled()
    })
})
