import {afterEach, describe, expect, it, vi} from 'vitest'
import Account from '../../src/models/account.js'
import {buildUserProfile, userProfilePath, userProfilesEnabled, userProfileUrl} from '../../src/utils/user/user-profile.js'

const account = (name, type, extra = {}) => new Account().fromKubernetes({
    metadata: {name},
    spec: {type},
    status: {
        primaryEmail: `${name}@example.com`,
        emails: [`${name}@example.com`, `${name}@private.example`],
        profile: {name: 'Alice Example', company: 'Example OÜ', phones: ['+372 5555 5555']},
        slackId: 'U123',
        groups: [{prefix: 'local', name: 'admin'}, {prefix: 'local', name: 'secret-project'}],
        conditions: [],
        ...extra,
    },
})

afterEach(() => vi.unstubAllEnvs())

describe('user profile pages', () => {
    it('are off unless enabled', () => {
        expect(userProfilesEnabled({})).toBe(false)
        expect(userProfilesEnabled({USER_PROFILES_ENABLED: 'true'})).toBe(true)
    })

    it('builds the page URL from the issuer', () => {
        expect(userProfilePath('alice')).toBe('/users/alice')
        expect(userProfileUrl('alice', {ISSUER_URL: 'https://auth.example.com/'})).toBe('https://auth.example.com/users/alice')
    })

    it('shows a refined projection, with only the listed groups', () => {
        const profile = buildUserProfile(account('alice', 'person'), {slackTeamId: 'T1', listedGroups: ['local:admin', 'local:billing']})
        expect(profile).toEqual({
            username: 'alice',
            type: 'person',
            name: 'Alice Example',
            company: 'Example OÜ',
            email: 'alice@example.com',
            slackUrl: 'slack://user?team=T1&id=U123',
            roles: ['local:admin'],
        })
        // Nothing else about the account leaves it.
        expect(JSON.stringify(profile)).not.toMatch(/secret-project|private\.example|5555/)
    })

    it('lists no roles when no groups are published', () => {
        expect(buildUserProfile(account('alice')).roles).toEqual([])
        expect(buildUserProfile(account('alice')).slackUrl).toBeUndefined()
    })

    it('shows people and service accounts, and no reserved names', () => {
        expect(buildUserProfile(account('alice')).type).toBe('person')
        expect(buildUserProfile(account('ci', 'service')).type).toBe('service')
        for (const type of ['banned', 'org', 'group']) {
            expect(buildUserProfile(account('reserved', type)), type).toBeUndefined()
        }
        expect(buildUserProfile(undefined)).toBeUndefined()
    })

    it('issues the profile claim with the profile scope only when enabled', async () => {
        const alice = account('alice', 'person')
        expect((await alice.claims('id_token', 'openid profile')).profile).toBeUndefined()
        vi.stubEnv('USER_PROFILES_ENABLED', 'true')
        expect((await alice.claims('id_token', 'openid profile')).profile).toBe(`${process.env.ISSUER_URL}users/alice`)
        expect((await alice.claims('id_token', 'openid')).profile).toBeUndefined()
    })
})
