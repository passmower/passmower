import {afterEach, describe, expect, it, vi} from 'vitest'
import {getGitHubConfig} from '../../src/utils/github.js'
import {getGitHubEmails} from '../../src/services/login/github-login.js'
import {KubeOIDCUserService} from '../../src/services/kube-oidc-user-service.js'
import {FakeKubernetesAdapter} from '../fakes/fake-kubernetes-adapter.js'

const hosts = [
    ['github.com', 'https://api.github.com/'],
    ['example.ghe.com', 'https://api.example.ghe.com/'],
    ['github.example.com', 'https://github.example.com/api/v3/'],
]

afterEach(() => {
    vi.unstubAllEnvs()
})

describe('GitHub host configuration', () => {
    it('preserves GitHub.com as the default', () => {
        expect(getGitHubConfig({})).toEqual({
            host: 'github.com',
            oauthBaseUrl: 'https://github.com/',
            apiBaseUrl: 'https://api.github.com/',
        })
    })

    it.each(hosts)('selects OAuth and REST endpoints for %s', (host, apiBaseUrl) => {
        expect(getGitHubConfig({GITHUB_HOST: host})).toEqual({
            host, oauthBaseUrl: `https://${host}/`, apiBaseUrl,
        })
    })

    it('normalizes hostname case', () => {
        expect(getGitHubConfig({GITHUB_HOST: 'EXAMPLE.GHE.COM'}).host).toBe('example.ghe.com')
    })

    it.each(['https://example.ghe.com', 'example.ghe.com/path', 'user@example.ghe.com',
        'example.ghe.com:443', 'example.ghe.com?query', 'example..ghe.com', '-example.ghe.com',
        'example.ghe.com#fragment', 'example.ghe.com\\path'])('rejects a non-hostname: %s', host => {
        expect(() => getGitHubConfig({GITHUB_HOST: host})).toThrow(/GITHUB_HOST/)
    })

    it.each(hosts)('collects verified email evidence from %s', async (host, apiBaseUrl) => {
        vi.stubEnv('GITHUB_HOST', host)
        const fetchImpl = vi.fn().mockResolvedValue({json: async () => [
            {email: 'verified@example.com', verified: true},
            {email: 'unverified@example.com', verified: false},
        ]})

        const emails = await getGitHubEmails('token', fetchImpl, '2026-11-13T12:00:00.000Z')

        expect(fetchImpl).toHaveBeenCalledWith(`${apiBaseUrl}user/emails`, {
            method: 'GET', headers: {Authorization: 'Bearer token'},
        })
        expect(emails).toEqual([{
            email: 'verified@example.com', verified: true, observedAt: '2026-11-13T12:00:00.000Z',
        }])
    })
})

describe('GitHub stable identities', () => {
    it('persists the hostname atomically when enrolling a GitHub user', async () => {
        globalThis.logger ??= {info() {}, warn() {}, error() {}, debug() {}}
        const adapter = new FakeKubernetesAdapter()
        const service = new KubeOIDCUserService(adapter)

        const account = await service.createUser('alice', undefined, [], {
            githubId: 12345, githubHost: 'example.ghe.com',
        })

        expect(account.getGithubHost()).toBe('example.ghe.com')
        expect(adapter.list('OIDCUser')[0].github).toMatchObject({id: 12345, host: 'example.ghe.com'})
        expect(await service.findUserByGithubId(12345)).toBeUndefined()
        expect((await service.findUserByGithubId(12345, undefined, 'example.ghe.com')).accountId).toBe('alice')
    })

    it('keeps identical numeric IDs on different hosts separate, including legacy records', async () => {
        const adapter = new FakeKubernetesAdapter()
        const service = new KubeOIDCUserService(adapter)
        for (const [name, host] of [['legacy', undefined], ['enterprise', 'example.ghe.com']]) {
            adapter.seed('OIDCUser', {
                metadata: {name, namespace: 'test', uid: name},
                spec: {type: 'person'}, status: {},
                github: {id: 12345, ...(host ? {host} : {})},
            })
        }

        const legacy = await service.findUserByGithubId(12345)
        const enterprise = await service.findUserByGithubId(12345, undefined, 'example.ghe.com')
        const other = await service.findUserByGithubId(12345, undefined, 'other.ghe.com')

        expect(legacy.accountId).toBe('legacy')
        expect(enterprise.accountId).toBe('enterprise')
        expect(other).toBeUndefined()
    })
})

vi.mock('../../src/utils/session/audit-log.js', () => ({auditLog: vi.fn()}))
vi.mock('../../src/utils/user/get-login-result.js', () => ({
    default: vi.fn().mockResolvedValue({login: {accountId: 'alice'}}),
}))

describe('GitHub OAuth login flow', () => {
    afterEach(() => {
        vi.restoreAllMocks()
        vi.unstubAllGlobals()
        vi.resetModules()
    })

    it.each(hosts)('uses %s for authorization, token exchange, profile and teams', async (host, apiBaseUrl) => {
        vi.stubEnv('GITHUB_HOST', host)
        vi.stubEnv('GITHUB_ORGANIZATION', 'Example-Org')
        vi.stubEnv('GH_CLIENT_ID', 'client-id')
        vi.stubEnv('GH_CLIENT_SECRET', 'client-secret')
        vi.resetModules()
        const [{default: login}, {default: Account}, {OAuth2}] = await Promise.all([
            import('../../src/services/login/github-login.js'),
            import('../../src/models/account.js'),
            import('oauth'),
        ])
        const account = {accountId: 'alice'}
        const findAccount = vi.spyOn(Account, 'createOrUpdateByEmails').mockResolvedValue(account)
        const tokenRequest = vi.spyOn(OAuth2.prototype, '_request').mockImplementation(
            (method, url, headers, body, token, callback) => {
                callback(null, JSON.stringify({access_token: 'token'}), {})
            })
        const fetchImpl = vi.fn()
            .mockResolvedValueOnce({json: async () => [{email: 'alice@example.com', verified: true}]})
            .mockResolvedValueOnce({json: async () => ({id: 12345, login: 'alice'})})
            .mockResolvedValueOnce({json: async () => [{slug: 'devops'}]})
            .mockResolvedValueOnce({json: async () => ({state: 'active'})})
        vi.stubGlobal('fetch', fetchImpl)
        const ctx = {
            params: {uid: 'interaction'}, request: {body: {}},
            req: {}, res: {}, redirect: vi.fn(), cookies: {get: vi.fn()},
            kubeOIDCUserService: {updateUserSpecs: vi.fn()},
        }
        const provider = {
            interactionDetails: vi.fn().mockResolvedValue({result: {state: 'state'}}),
            interactionResult: vi.fn(), interactionFinished: vi.fn(),
        }

        await login(ctx, provider)
        const authorizationUrl = new URL(ctx.redirect.mock.calls[0][0])
        ctx.request.body = {code: 'code', state: 'state'}
        await login(ctx, provider)

        expect(authorizationUrl.origin + authorizationUrl.pathname)
            .toBe(`https://${host}/login/oauth/authorize`)
        expect(authorizationUrl.searchParams.get('scope')).toBe('user:email read:org')
        expect(tokenRequest.mock.calls[0][1]).toBe(`https://${host}/login/oauth/access_token`)
        expect(fetchImpl.mock.calls.map(([url]) => url)).toEqual([
            `${apiBaseUrl}user/emails`, `${apiBaseUrl}user`,
            `${apiBaseUrl}orgs/Example-Org/teams`,
            `${apiBaseUrl}orgs/Example-Org/teams/devops/memberships/alice`,
        ])
        expect(findAccount.mock.calls[0][6]).toEqual({githubId: 12345, githubHost: host})
        expect(ctx.kubeOIDCUserService.updateUserSpecs).toHaveBeenCalledWith('alice', {
            github: expect.objectContaining({
                host, id: 12345,
                groups: [{prefix: host, name: 'Example-Org:devops'}],
            }),
        })
        expect(provider.interactionFinished).toHaveBeenCalled()
    })
})
