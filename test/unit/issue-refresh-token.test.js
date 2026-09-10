import {beforeEach, describe, expect, it, vi} from 'vitest'
import configuration from '../../src/configuration.js'

// A refresh token goes to any client allowed the refresh_token grant, whether or
// not offline_access was granted — these tokens expire with the session, so they
// are renewal rather than offline access (#243). The grant-type half is what
// stops a client being handed a token the token endpoint refuses.
describe('issueRefreshToken', () => {
    const code = (scopes) => ({scopes: new Set(scopes)})
    const client = (grants) => ({
        clientId: 'apps.grafana',
        grantTypeAllowed: (grant) => grants.includes(grant),
    })
    const ctx = (scope) => ({headers: {}, oidc: {params: scope ? {scope} : {}}})

    beforeEach(() => {
        globalThis.logger = {debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn(), trace: vi.fn()}
    })

    it('issues to a client allowed the grant, with or without offline_access', async () => {
        const allowed = client(['authorization_code', 'refresh_token'])

        await expect(configuration.issueRefreshToken(ctx('openid'), allowed, code(['openid'])))
            .resolves.toBe(true)
        await expect(configuration.issueRefreshToken(
            ctx('openid offline_access'), allowed, code(['openid', 'offline_access'])))
            .resolves.toBe(true)
    })

    it('withholds from a client not allowed the grant', async () => {
        await expect(configuration.issueRefreshToken(
            ctx('openid'), client(['authorization_code']), code(['openid'])))
            .resolves.toBe(false)
    })

    it('reports the mismatch when such a client asked for offline access', async () => {
        await configuration.issueRefreshToken(
            ctx('openid offline_access'), client(['authorization_code']), code(['openid']))

        expect(globalThis.logger.info).toHaveBeenCalledWith(
            expect.objectContaining({clientId: 'apps.grafana'}),
            expect.stringContaining('not allowed the refresh_token grant'),
        )
    })

    it('stays quiet for a client that never asked for offline access', async () => {
        // Most clients never want renewal; withholding is not news.
        await configuration.issueRefreshToken(
            ctx('openid'), client(['authorization_code']), code(['openid']))

        expect(globalThis.logger.info).not.toHaveBeenCalled()
    })
})
