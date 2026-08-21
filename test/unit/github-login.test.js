import {describe, expect, it, vi} from 'vitest'
import {getGitHubEmails, getGitHubScopes} from '../../src/services/login/github-login.js'

describe('email-free GitHub login', () => {
    it('does not request email permission or call the email API when disabled', async () => {
        const env = {EMAIL_ENABLED: 'false', GITHUB_ORGANIZATION: 'codemowers'}
        const fetchImpl = vi.fn()

        expect(getGitHubScopes(env)).toEqual(['read:org'])
        await expect(getGitHubEmails('token', fetchImpl, env)).resolves.toEqual([])
        expect(fetchImpl).not.toHaveBeenCalled()
    })

    it('retains only verified GitHub addresses when enabled', async () => {
        const fetchImpl = vi.fn().mockResolvedValue({json: async () => [
            {email: 'verified@example.com', verified: true},
            {email: 'unknown@example.com', verified: false},
        ]})

        expect(getGitHubScopes({EMAIL_ENABLED: 'true'})).toEqual(['user:email'])
        await expect(getGitHubEmails('token', fetchImpl, {EMAIL_ENABLED: 'true'}))
            .resolves.toEqual([{email: 'verified@example.com', verified: true}])
    })
})
