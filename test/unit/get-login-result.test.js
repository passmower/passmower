import {describe, expect, it, vi} from 'vitest'

vi.mock('../../src/utils/session/audit-log.js', () => ({auditLog: vi.fn()}))

import getLoginResult from '../../src/utils/user/get-login-result.js'

const provider = {interactionDetails: vi.fn().mockResolvedValue({uid: 'interaction'})}
const ctx = {req: {}, res: {}}
const account = type => ({accountId: 'subject', type})

describe('login result account-type enforcement', () => {
    it('allows people and legacy accounts', async () => {
        await expect(getLoginResult(ctx, provider, account('person'), 'OIDC')).resolves.toEqual({
            login: {accountId: 'subject'},
        })
        await expect(getLoginResult(ctx, provider, account(null), 'OIDC')).resolves.toEqual({
            login: {accountId: 'subject'},
        })
    })

    it.each(['service', 'org', 'group', 'banned'])(
        'returns a neutral access denial for an ordinary %s login', async type => {
            await expect(getLoginResult(ctx, provider, account(type), 'OIDC')).resolves.toEqual({
                error: 'access_denied',
                error_description: 'This account cannot sign in',
            })
        },
    )

    it('permits service accounts only through explicit impersonation', async () => {
        await expect(getLoginResult(
            ctx, provider, account('service'), 'Impersonation', {impersonation: true},
        )).resolves.toEqual({login: {accountId: 'subject'}})
    })
})
