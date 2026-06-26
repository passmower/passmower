import { describe, it, expect, vi, afterEach } from 'vitest'
import Account from '../../src/models/account.js'

// Build an Account the way the Kubernetes adapter would, from an OIDCUser-shaped object.
function account(overrides = {}) {
    return new Account().fromKubernetes({
        metadata: { name: 'u-test', labels: {}, ...overrides.metadata },
        spec: overrides.spec,
        passmower: overrides.passmower,
        slack: overrides.slack,
        github: overrides.github,
        identities: overrides.identities,
        webauthn: overrides.webauthn,
        status: overrides.status,
    })
}

afterEach(() => vi.unstubAllEnvs())

describe('Account.getIntendedStatus', () => {
    it('aggregates and de-duplicates emails across spec, github and identities', () => {
        const status = account({
            spec: { email: 'a@spec.com' },
            github: { emails: [{ email: 'a@spec.com', primary: true }, { email: 'gh@x.com' }] },
            identities: { google: { emails: [{ email: 'g@corp.example.com' }] } },
        }).getIntendedStatus()

        expect(status.emails).toEqual(['a@spec.com', 'gh@x.com', 'g@corp.example.com'])
    })

    it('falls back to spec.email as primary when no preferred domain is set', () => {
        const status = account({
            spec: { email: 'a@spec.com' },
            identities: { google: { emails: [{ email: 'g@corp.example.com' }] } },
        }).getIntendedStatus()

        expect(status.primaryEmail).toBe('a@spec.com')
    })

    it('prefers an email in PREFERRED_EMAIL_DOMAIN when set', () => {
        vi.stubEnv('PREFERRED_EMAIL_DOMAIN', 'corp.example.com')
        const status = account({
            spec: { email: 'a@spec.com' },
            identities: { google: { emails: [{ email: 'g@corp.example.com' }] } },
        }).getIntendedStatus()

        expect(status.primaryEmail).toBe('g@corp.example.com')
    })

    it('merges groups from all sources and de-duplicates by prefix:name', () => {
        const status = account({
            spec: { groups: [{ prefix: 'local', name: 'team' }] },
            github: { groups: [{ prefix: 'gh', name: 'org' }, { prefix: 'local', name: 'team' }] },
            identities: { google: { groups: [{ prefix: 'google.com', name: 'eng' }] } },
        }).getIntendedStatus()

        const keys = status.groups.map(g => `${g.prefix}:${g.name}`)
        expect(keys).toEqual(['local:team', 'gh:org', 'google.com:eng'])
    })

    it('resolves profile name/company from the highest-priority source', () => {
        const status = account({
            github: { name: 'GH Name', company: 'GH Co' },
            identities: { google: { name: 'Google Name' } },
        }).getIntendedStatus()

        expect(status.profile.name).toBe('GH Name')
        expect(status.profile.company).toBe('GH Co')
    })
})

describe('Account.claims', () => {
    it('returns sub/username/email for openid scope', async () => {
        const a = account({
            status: { primaryEmail: 'a@x.com', emails: [{ email: 'a@x.com', primary: true }], groups: [], profile: {} },
        })
        const claims = await a.claims('id_token', 'openid', {}, [])
        expect(claims.sub).toBe('u-test')
        expect(claims.username).toBe('u-test')
        expect(claims.email).toBe('a@x.com')
    })

    it('adds profile fields and emails for the profile scope', async () => {
        const a = account({
            status: {
                primaryEmail: 'a@x.com',
                emails: [{ email: 'a@x.com', primary: true }],
                groups: [],
                profile: { name: 'Jane', company: 'Acme' },
            },
        })
        const claims = await a.claims('id_token', 'openid profile', {}, [])
        expect(claims.name).toBe('Jane')
        expect(claims.company).toBe('Acme')
        expect(claims.emails).toEqual([{ email: 'a@x.com', primary: true }])
    })
})

describe('Account.getRemoteHeaders', () => {
    it('maps account fields onto the configured forward-auth header names', () => {
        const a = account({
            status: {
                primaryEmail: 'a@x.com',
                profile: { name: 'Jane' },
                groups: [{ prefix: 'gh', name: 'org' }, { prefix: 'local', name: 'team' }],
            },
        })
        const headers = a.getRemoteHeaders({
            user: 'X-User', name: 'X-Name', email: 'X-Email', groups: 'X-Groups',
        })
        expect(headers['X-User']).toBe('u-test')
        expect(headers['X-Name']).toBe('Jane')
        expect(headers['X-Email']).toBe('a@x.com')
        expect(headers['X-Groups'].split(',').sort()).toEqual(['gh:org', 'local:team'])
    })
})
