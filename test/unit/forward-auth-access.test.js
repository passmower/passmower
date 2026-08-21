import {beforeEach, describe, expect, it, vi} from 'vitest'
import Koa from 'koa'
import request from 'supertest'

const mocks = vi.hoisted(() => ({failure: null, auditLog: vi.fn()}))

vi.mock('../../src/utils/session/site-session.js', () => ({
    validateSiteSession: vi.fn().mockResolvedValue({accountId: 'alice'}),
}))
vi.mock('../../src/adapters/redis.js', () => ({
    default: class RedisAdapter {
        async find() {
            return {headerMapping: {user: 'Remote-User'}}
        }
    },
}))
vi.mock('../../src/models/account.js', () => ({
    default: {findAccount: vi.fn().mockResolvedValue({
        getRemoteHeaders: () => ({'Remote-User': 'alice'}),
    })},
}))
vi.mock('../../src/utils/session/base-domain.js', () => ({
    isHostInProviderBaseDomain: () => true,
}))
vi.mock('../../src/utils/user/check-account-access.js', () => ({
    getAccountAccessFailure: () => mocks.failure,
}))
vi.mock('../../src/utils/session/audit-log.js', () => ({auditLog: mocks.auditLog}))

import forwardAuthRoutes from '../../src/routes/forwardAuthRoutes.js'

const app = new Koa()
app.use(forwardAuthRoutes({}).routes())

const callForwardAuth = () => request(app.callback())
    .get('/forward-auth?client=apps.webmail')
    .set('x-forwarded-host', 'webmail.example.com')
    .set('x-forwarded-proto', 'https')
    .set('x-forwarded-uri', '/')

beforeEach(() => {
    mocks.failure = null
    mocks.auditLog.mockReset()
})

describe('forward-auth live access policy', () => {
    it('returns identity headers while the account remains eligible', async () => {
        const response = await callForwardAuth().expect(200)
        expect(response.headers['remote-user']).toBe('alice')
    })

    it('returns 401 without identity headers after policy state changes', async () => {
        mocks.failure = 'client_access_required'
        const response = await callForwardAuth().expect(401)
        expect(response.headers['remote-user']).toBeUndefined()
        expect(mocks.auditLog).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
            accountId: 'alice', failure: 'client_access_required',
        }), 'Forward-auth account no longer satisfies access policy')
    })
})
