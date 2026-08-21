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

    it('stores ToS acceptance outside conditions', () => {
        const acceptedAt = new Date('2026-08-06T12:00:00.000Z')
        const status = account({status: {conditions: [{type: 'Ready', status: 'True'}]}})
            .acceptTermsOfService('content-hash', acceptedAt)
            .getIntendedStatus()

        expect(status.termsOfService).toEqual({
            acceptedAt: acceptedAt.toISOString(),
            contentHash: 'content-hash',
        })
        expect(status.conditions).toEqual([{type: 'Ready', status: 'True'}])
    })

    it('migrates legacy ToSv1 acceptance on the next status projection', () => {
        const status = account({status: {conditions: [{
            type: 'ToSv1', status: 'True', lastTransitionTime: '2025-01-01T00:00:00.000Z',
        }, {type: 'Ready', status: 'True'}]}}).getIntendedStatus()

        expect(status.termsOfService).toEqual({
            acceptedAt: '2025-01-01T00:00:00.000Z',
            contentHash: null,
        })
        expect(status.conditions).toEqual([{type: 'Ready', status: 'True'}])
    })
})

describe('Account.getProfileResponse', () => {
    const recentApplications = [{
        clientId: 'apps.grafana',
        clientNamespace: 'apps',
        clientName: 'grafana',
        clientKind: 'OIDCClient',
        lastAuthenticatedAt: '2026-08-05T12:30:00.000Z',
        ignoredRawField: 'not-for-the-api',
    }]

    it('exposes a refined recent-application projection to admins', () => {
        const response = account({status: {recentApplications}}).getProfileResponse(true, 'admin')
        expect(response.recentApplications).toEqual([{
            clientId: 'apps.grafana',
            namespace: 'apps',
            name: 'grafana',
            kind: 'OIDCClient',
            lastAuthenticatedAt: '2026-08-05T12:30:00.000Z',
        }])
        expect(response.recentApplications[0].ignoredRawField).toBeUndefined()
    })

    it('does not expose recent application activity in the ordinary profile response', () => {
        const response = account({status: {recentApplications}}).getProfileResponse()
        expect(response.recentApplications).toBeUndefined()
    })

    it('exposes the onboarder only in the admin profile response', () => {
        const invited = account({passmower: {onboardedBy: 'admin-user'}})

        expect(invited.getProfileResponse(true).onboardedBy).toBe('admin-user')
        expect(invited.getProfileResponse().onboardedBy).toBeUndefined()
    })

    it('returns null onboarder metadata for users not created through an admin invite', () => {
        expect(account().getProfileResponse(true).onboardedBy).toBeNull()
    })

    it('projects the dedicated ToS acceptance timestamp without exposing its content hash', () => {
        const response = account({status: {termsOfService: {
            acceptedAt: '2026-08-06T12:00:00.000Z',
            contentHash: 'content-hash',
        }}}).getProfileResponse()

        expect(response.tos_accepted_at).toBe('2026-08-06T12:00:00.000Z')
        expect(response.termsOfService).toBeUndefined()
    })
})

describe('Account.claims', () => {
    it('returns email claims only for the email scope', async () => {
        const a = account({
            status: { primaryEmail: 'a@x.com', emails: [{ email: 'a@x.com', primary: true }], groups: [], profile: {} },
        })
        const openidClaims = await a.claims('id_token', 'openid', {}, [])
        const claims = await a.claims('id_token', 'openid email', {}, [])
        expect(openidClaims.email).toBeUndefined()
        expect(openidClaims.email_verified).toBeUndefined()
        expect(claims.sub).toBe('u-test')
        expect(claims.username).toBe('u-test')
        expect(claims.email).toBe('a@x.com')
        expect(claims.email_verified).toBe(false)
    })

    it('omits both email claims when an account has no primary email', async () => {
        const claims = await account({
            status: {primaryEmail: undefined, emails: [], groups: [], profile: {}},
        }).claims('id_token', 'openid email', {}, [])

        expect(claims.email).toBeUndefined()
        expect(claims.email_verified).toBeUndefined()
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

    it('marks a primary GitHub email verified only with explicit GitHub evidence', async () => {
        const a = account({
            github: {emails: [{email: 'a@x.com', primary: true, verified: true}]},
            status: {primaryEmail: 'a@x.com', emails: ['a@x.com'], groups: [], profile: {}},
        })
        const legacy = account({
            github: {emails: [{email: 'a@x.com', primary: true}]},
            status: {primaryEmail: 'a@x.com', emails: ['a@x.com'], groups: [], profile: {}},
        })

        expect((await a.claims('id_token', 'openid email', {}, [])).email_verified).toBe(true)
        expect((await legacy.claims('id_token', 'openid email', {}, [])).email_verified).toBe(false)
    })

    it('only marks generic OIDC email provenance verified when upstream explicitly confirmed it', async () => {
        const verified = account({
            identities: {google: {emails: [{email: 'a@x.com', primary: true, verified: true}]}},
            status: {primaryEmail: 'a@x.com', emails: ['a@x.com'], groups: [], profile: {}},
        })
        const unverified = account({
            identities: {google: {emails: [{email: 'a@x.com', primary: true, verified: false}]}},
            status: {primaryEmail: 'a@x.com', emails: ['a@x.com'], groups: [], profile: {}},
        })
        const unspecified = account({
            identities: {google: {emails: [{email: 'a@x.com', primary: true}]}},
            status: {primaryEmail: 'a@x.com', emails: ['a@x.com'], groups: [], profile: {}},
        })

        expect((await verified.claims('id_token', 'openid email', {}, [])).email_verified).toBe(true)
        expect(unverified.getIntendedStatus().emailVerifications).toContainEqual({
            email: 'a@x.com', status: 'unverified', method: 'oidc-claim', provider: 'google',
        })
        expect((await unspecified.claims('id_token', 'openid email', {}, [])).email_verified).toBe(false)
        expect(unspecified.getIntendedStatus().emailVerifications).toContainEqual({
            email: 'a@x.com', status: 'unknown', method: 'oidc-claim', provider: 'google',
        })
    })

    it('does not transfer verification when the emitted primary email changes', async () => {
        const a = account({
            spec: {email: 'new@x.com'},
            github: {emails: [{email: 'old@x.com', primary: true, verified: true}]},
            status: {primaryEmail: 'new@x.com', emails: ['new@x.com', 'old@x.com'], groups: [], profile: {}},
        })

        expect((await a.claims('id_token', 'openid email', {}, [])).email_verified).toBe(false)
    })

    it('records durable magic-link evidence for the exact claimed address', () => {
        const verifiedAt = '2026-08-16T21:00:00.000Z'
        const status = account({
            spec: {email: 'a@x.com'},
            status: {primaryEmail: 'a@x.com', emails: ['a@x.com'], groups: [], profile: {}},
        }).verifyEmail('A@X.COM', {verifiedAt}).getIntendedStatus()

        expect(status.emailVerifications).toContainEqual({
            email: 'a@x.com', status: 'verified', method: 'magic-link',
            provider: 'passmower', verifiedAt,
        })
    })

    it('retains durable magic-link evidence while its address is unlinked', () => {
        const status = account({
            status: {
                primaryEmail: null, emails: [], groups: [], profile: {},
                emailVerifications: [{
                    email: 'old@x.com', status: 'verified', method: 'magic-link',
                    provider: 'passmower', verifiedAt: '2026-08-16T21:00:00.000Z',
                }],
            },
        }).getIntendedStatus()

        expect(status.emailVerifications).toContainEqual(expect.objectContaining({
            email: 'old@x.com', status: 'verified', method: 'magic-link',
        }))
    })

    it('omits namespaces when the enrichment webhook is not configured', async () => {
        const a = account({ status: { primaryEmail: 'a@x.com', groups: [], profile: {} } })
        const claims = await a.claims('id_token', 'openid namespaces', {}, [])
        expect(claims['codemowers.io/namespaces']).toBeUndefined()
    })

    it('merges the namespaces claim from the enrichment webhook when granted', async () => {
        vi.stubEnv('EXTRA_CLAIMS_WEBHOOK_URL', 'http://webhook.test/enrich')
        const fetchMock = vi.fn().mockResolvedValue({
            ok: true,
            json: async () => ({ 'codemowers.io/namespaces': ['tenant-demo'] }),
        })
        vi.stubGlobal('fetch', fetchMock)

        const a = account({ status: { primaryEmail: 'a@x.com', groups: [], profile: {} } })
        const claims = await a.claims('id_token', 'openid namespaces', {}, [])

        expect(claims['codemowers.io/namespaces']).toEqual(['tenant-demo'])
        expect(fetchMock).toHaveBeenCalledOnce()
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

    it('omits an email header when the account has no email', () => {
        const headers = account({status: {profile: {name: 'Jane'}, groups: []}}).getRemoteHeaders({
            user: 'X-User', name: 'X-Name', email: 'X-Email', groups: 'X-Groups',
        })
        expect(headers).not.toHaveProperty('X-Email')
    })
})
