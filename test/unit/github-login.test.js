import {describe, expect, it, vi} from 'vitest'
import {
    getGitHubAuthorizeParams,
    getGitHubEmails,
    getGitHubScopes,
} from '../../src/services/login/github-login.js'

describe('GitHub email collection', () => {
    it('requests user:email regardless of EMAIL_ENABLED (delivery-only switch)', () => {
        // EMAIL_ENABLED governs outbound delivery; email identity collection
        // and downstream email claims must keep working when it is off.
        expect(getGitHubScopes({EMAIL_ENABLED: 'false', GITHUB_ORGANIZATION: 'codemowers'}))
            .toEqual(['user:email', 'read:org'])
        expect(getGitHubScopes({EMAIL_ENABLED: 'false'})).toEqual(['user:email'])

        const params = getGitHubAuthorizeParams('state', {
            EMAIL_ENABLED: 'false',
            ISSUER_URL: 'https://passmower.example/',
        })
        expect(params.scope).toBe('user:email')
    })

    it('sends multiple scopes as one space-delimited value', () => {
        // An array here querystring-encodes as repeated scope= params and
        // GitHub honors only one, issuing a token without user:email.
        const params = getGitHubAuthorizeParams('state', {
            EMAIL_ENABLED: 'true',
            GITHUB_ORGANIZATION: 'codemowers',
            ISSUER_URL: 'https://passmower.example/',
        })
        expect(params.scope).toBe('user:email read:org')
    })

    it('surfaces the GitHub error body when the email API rejects the token', async () => {
        const fetchImpl = vi.fn().mockResolvedValue({
            status: 404,
            json: async () => ({message: 'Not Found'}),
        })
        await expect(getGitHubEmails('token', fetchImpl))
            .rejects.toThrow(/404.*Not Found/)
    })

    it('retains only verified GitHub addresses when enabled', async () => {
        const fetchImpl = vi.fn().mockResolvedValue({json: async () => [
            {email: 'verified@example.com', verified: true},
            {email: 'unknown@example.com', verified: false},
        ]})

        expect(getGitHubScopes({EMAIL_ENABLED: 'true'})).toEqual(['user:email'])
        await expect(getGitHubEmails('token', fetchImpl, '2026-08-22T10:00:00.000Z'))
            .resolves.toEqual([{
                email: 'verified@example.com', verified: true,
                observedAt: '2026-08-22T10:00:00.000Z',
            }])
    })

    it('preserves GitHub primary/verified/private metadata as exact-address evidence', async () => {
        const fetchImpl = vi.fn().mockResolvedValue({json: async () => [{
            email: 'private@example.com', primary: true, verified: true, visibility: null,
        }]})
        await expect(getGitHubEmails('token', fetchImpl, '2026-08-22T10:00:00.000Z'))
            .resolves.toMatchObject([{
                email: 'private@example.com', primary: true, verified: true, visibility: null,
            }])
    })
})
