import { describe, it, expect, beforeAll, beforeEach } from 'vitest'
import { KubeOIDCUserService } from '../../src/services/kube-oidc-user-service.js'
import { FakeKubernetesAdapter } from '../fakes/fake-kubernetes-adapter.js'

// Exercises the real user-service + Account model against the in-memory fake
// adapter — i.e. the exact code path that reads/writes OIDCUser custom resources.
describe('KubeOIDCUserService over the fake Kubernetes adapter', () => {
    let adapter
    let service

    beforeAll(() => {
        globalThis.logger ??= { info() {}, warn() {}, error() {}, debug() {} }
    })

    beforeEach(() => {
        adapter = new FakeKubernetesAdapter()
        service = new KubeOIDCUserService(adapter)
    })

    it('creates a user and computes its status', async () => {
        const account = await service.createUser('alice', 'alice@example.com', [])
        expect(account.accountId).toBe('alice')

        const stored = adapter.list('OIDCUser')
        expect(stored).toHaveLength(1)
        expect(stored[0].passmower.email).toBe('alice@example.com')
        expect(stored[0].status.primaryEmail).toBe('alice@example.com')
        expect(stored[0].metadata.labels).toMatchObject({
            'codemowers.cloud/claimed-by': adapter.instance,
        })
    })

    it('finds a user by id and by email', async () => {
        await service.createUser('bob', 'bob@example.com', [])
        expect((await service.findUser('bob')).accountId).toBe('bob')
        expect(await service.findUser('nope')).toBeUndefined()

        const byEmail = await service.findUserByEmails(['bob@example.com'])
        expect(byEmail.accountId).toBe('bob')
        expect(await service.findUserByEmails(['nobody@example.com'])).toBeUndefined()
    })

    it('refuses to create a user whose name is already taken', async () => {
        await service.createUser('carol', 'carol@example.com', [])
        expect(await service.createUser('carol', 'carol2@example.com', [])).toBeNull()
        expect(adapter.list('OIDCUser')).toHaveLength(1)
    })

    it('merges an upstream identity into specs and recomputes status', async () => {
        await service.createUser('dave', 'dave@example.com', [])
        await service.updateUserSpecs('dave', {
            identities: {
                google: {
                    sub: 'g-1',
                    emails: [{ email: 'dave@corp.example.com', primary: false }],
                    groups: [{ prefix: 'google.com', name: 'eng' }],
                },
            },
        })

        const stored = adapter.list('OIDCUser')[0]
        expect(stored.identities.google.sub).toBe('g-1')
        expect(stored.status.emails).toContain('dave@corp.example.com')
        expect(stored.status.groups.map(g => `${g.prefix}:${g.name}`)).toContain('google.com:eng')
    })

    it('adds, renames and removes a passkey', async () => {
        await service.createUser('erin', 'erin@example.com', [])
        const cred = { id: 'cred-1', publicKey: 'pk', counter: 0, name: 'YubiKey' }

        await service.addPasskey('erin', cred)
        expect((await service.findUserByPasskeyId('cred-1')).accountId).toBe('erin')

        await service.renamePasskey('erin', 'cred-1', 'Phone')
        expect(adapter.list('OIDCUser')[0].webauthn.credentials[0].name).toBe('Phone')

        await service.updatePasskeyCounter('erin', 'cred-1', 5)
        expect(adapter.list('OIDCUser')[0].webauthn.credentials[0].counter).toBe(5)

        await service.removePasskey('erin', 'cred-1')
        expect(adapter.list('OIDCUser')[0].webauthn.credentials).toHaveLength(0)
    })
})
