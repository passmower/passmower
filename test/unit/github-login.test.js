import {describe, expect, it, vi} from 'vitest'
import {
    getGitHubAuthorizeParams,
    getGitHubEmails,
    getGitHubScopes,
} from '../../src/services/login/github-login.js'

describe('email-free GitHub login', () => {
    it('does not request email permission or call the email API when disabled', async () => {
        const env = {EMAIL_ENABLED: 'false', GITHUB_ORGANIZATION: 'codemowers'}
        const fetchImpl = vi.fn()

        expect(getGitHubScopes(env)).toEqual(['read:org'])
        await expect(getGitHubEmails('token', fetchImpl, env)).resolves.toEqual([])
        expect(fetchImpl).not.toHaveBeenCalled()
    })

    it('omits the scope parameter when no GitHub permissions are needed', () => {
        const params = getGitHubAuthorizeParams('state', {
            EMAIL_ENABLED: 'false',
            ISSUER_URL: 'https://passmower.example/',
        })

        expect(params).toEqual({
            redirect_uri: 'https://passmower.example/interaction/callback/gh',
            state: 'state',
        })
        expect(params).not.toHaveProperty('scope')
    })

    it('retains only verified GitHub addresses when enabled', async () => {
        const fetchImpl = vi.fn().mockResolvedValue({json: async () => [
            {email: 'verified@example.com', verified: true},
            {email: 'unknown@example.com', verified: false},
        ]})

        expect(getGitHubScopes({EMAIL_ENABLED: 'true'})).toEqual(['user:email'])
        await expect(getGitHubEmails('token', fetchImpl, {EMAIL_ENABLED: 'true'}, '2026-08-22T10:00:00.000Z'))
            .resolves.toEqual([{
                email: 'verified@example.com', verified: true,
                observedAt: '2026-08-22T10:00:00.000Z',
            }])
    })

    it('preserves GitHub primary/verified/private metadata as exact-address evidence', async () => {
        const fetchImpl = vi.fn().mockResolvedValue({json: async () => [{
            email: 'private@example.com', primary: true, verified: true, visibility: null,
        }]})
        await expect(getGitHubEmails('token', fetchImpl, {EMAIL_ENABLED: 'true'}, '2026-08-22T10:00:00.000Z'))
            .resolves.toMatchObject([{
                email: 'private@example.com', primary: true, verified: true, visibility: null,
            }])
    })
})
