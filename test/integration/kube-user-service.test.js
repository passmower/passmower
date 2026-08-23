import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest'
import { KubeOIDCUserService } from '../../src/services/kube-oidc-user-service.js'
import { FakeKubernetesAdapter } from '../fakes/fake-kubernetes-adapter.js'
import {IdentityIntegrityError} from '../../src/utils/user/identity-integrity.js';

function rawUser(name, created, email, overrides = {}) {
    return {
        metadata: {name, namespace: 'test', creationTimestamp: created, uid: `uid-${name}`},
        spec: {type: 'person', email},
        status: {},
        ...overrides,
    }
}

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

    it('creates an email-less user with its stable OIDC identity atomically', async () => {
        const account = await service.createUser('subject-user', undefined, undefined, {
            providerKey: 'dex', subject: 'subject-123',
        })

        expect(account.accountId).toBe('subject-user')
        const stored = adapter.list('OIDCUser')[0]
        expect(stored.passmower.email).toBeUndefined()
        expect(stored.status.primaryEmail).toBeUndefined()
        expect(stored.identities.dex).toEqual({sub: 'subject-123'})
        expect((await service.findUserByIdentity('dex', 'subject-123')).accountId).toBe('subject-user')
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

    it('deterministically rejects a newer GitOps user with a duplicate email', async () => {
        adapter.seed('OIDCUser', rawUser('original', '2026-01-01T00:00:00Z', 'person@example.com'))
        adapter.seed('OIDCUser', rawUser('duplicate', '2026-02-01T00:00:00Z', 'PERSON@example.com'))
        globalThis.metrics = {oidcUserEmailConflicts: {set: vi.fn()}}

        const result = await service.reconcileEmailUniqueness()

        expect(result.conflictedUsers).toBe(1)
        const byName = Object.fromEntries(adapter.list('OIDCUser').map(user => [user.metadata.name, user]))
        expect(byName.original.status.conditions.find(c => c.type === 'EmailUnique').status).toBe('True')
        expect(byName.duplicate.status.conditions.find(c => c.type === 'EmailUnique')).toMatchObject({
            status: 'False',
            reason: 'DuplicateEmail',
            message: 'person@example.com is owned by OIDCUser original',
        })
        expect((await service.findUserByEmails(['person@example.com'])).accountId).toBe('original')
        expect(adapter.events).toHaveLength(1)
        expect(adapter.events[0]).toMatchObject({reason: 'DuplicateEmail', type: 'Warning'})
        expect(globalThis.metrics.oidcUserEmailConflicts.set).toHaveBeenCalledWith(1)
    })

    it('restores uniqueness after the original duplicate claim is removed', async () => {
        adapter.seed('OIDCUser', rawUser('original', '2026-01-01T00:00:00Z', 'person@example.com'))
        adapter.seed('OIDCUser', rawUser('duplicate', '2026-02-01T00:00:00Z', 'person@example.com'))
        await service.reconcileEmailUniqueness()
        adapter.delete('OIDCUser', 'original')

        await service.reconcileEmailUniqueness()

        const duplicate = adapter.list('OIDCUser')[0]
        expect(duplicate.status.conditions.find(c => c.type === 'EmailUnique')).toMatchObject({
            status: 'True', reason: 'Unique',
        })
        expect((await service.findUserByEmails(['person@example.com'])).accountId).toBe('duplicate')
    })

    it('preserves a concurrent EmailUnique transition time from the freshly read user', async () => {
        adapter.seed('OIDCUser', rawUser('original', '2026-01-01T00:00:00Z', 'person@example.com'))
        adapter.seed('OIDCUser', rawUser('duplicate', '2026-02-01T00:00:00Z', 'person@example.com'))
        const transitionTime = new Date('2026-08-01T10:00:00.000Z')
        const mutate = adapter.mutateNamespacedCustomObjectStatus.bind(adapter)
        adapter.mutateNamespacedCustomObjectStatus = async (kind, namespace, id, mapper, statusFunction) => {
            if (id === 'duplicate') {
                adapter.list('OIDCUser').find(user => user.metadata.name === id).status.conditions = [{
                    apiVersion: 'v1', kind: 'Condition', type: 'EmailUnique', status: 'False',
                    reason: 'ConcurrentDecision', message: 'concurrently evaluated', lastTransitionTime: transitionTime,
                }]
            }
            return mutate(kind, namespace, id, mapper, statusFunction)
        }

        await service.reconcileEmailUniqueness()

        const condition = adapter.list('OIDCUser')
            .find(user => user.metadata.name === 'duplicate')
            .status.conditions.find(item => item.type === 'EmailUnique')
        expect(condition).toMatchObject({status: 'False', reason: 'DuplicateEmail'})
        expect(condition.lastTransitionTime).toEqual(transitionTime)
    })

    it('rejects an upstream identity whose verified emails span multiple owners', async () => {
        adapter.seed('OIDCUser', rawUser('alice', '2026-01-01T00:00:00Z', 'alice@example.com'))
        adapter.seed('OIDCUser', rawUser('bob', '2026-01-02T00:00:00Z', 'bob@example.com'))
        await expect(service.findUserByEmails(['alice@example.com', 'bob@example.com']))
            .rejects.toBeInstanceOf(IdentityIntegrityError)
    })

    it('resolves an existing provider subject before an upstream email change', async () => {
        adapter.seed('OIDCUser', rawUser('alice', '2026-01-01T00:00:00Z', 'old@example.com', {
            identities: {google: {sub: 'google-123', emails: [{email: 'old@example.com', primary: true}]}},
        }))
        const found = await service.findUserByIdentity('google', 'google-123')
        expect(found.accountId).toBe('alice')
        expect(await service.findUserByEmails(['new@example.com'])).toBeUndefined()
    })

    it('resolves an existing GitHub numeric id independently of email', async () => {
        adapter.seed('OIDCUser', rawUser('alice', '2026-01-01T00:00:00Z', 'old@example.com', {
            github: {id: 12345, emails: [{email: 'old@example.com', primary: true}]},
        }))
        expect((await service.findUserByGithubId(12345)).accountId).toBe('alice')
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
