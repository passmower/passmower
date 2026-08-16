import {afterEach, describe, expect, it, vi} from 'vitest';
import {ActivityTracker} from '../../src/services/activity-tracker.js';
import {FakeKubernetesAdapter} from '../fakes/fake-kubernetes-adapter.js';
import OidcClient from '../../src/models/oidc-client.js';

function rawClient() {
    return {
        metadata: {
            name: 'grafana', namespace: 'apps', uid: 'client-1',
            resourceVersion: '1', creationTimestamp: '2026-01-01T00:00:00.000Z',
        },
        spec: {
            grantTypes: ['authorization_code'], responseTypes: ['code'],
            redirectUris: ['https://grafana.example/callback'], availableScopes: ['openid'],
        },
        status: {instance: 'test-passmower'},
    }
}

function rawUser() {
    return {
        metadata: {name: 'alice', namespace: 'apps', resourceVersion: '1'},
        spec: {type: 'person'},
        status: {recentApplications: [{
            clientId: 'apps.old', clientNamespace: 'apps', clientName: 'old',
            lastAuthenticatedAt: '2026-01-01T00:00:00.000Z',
        }]},
    }
}

describe('ActivityTracker', () => {
    afterEach(() => vi.unstubAllEnvs())

    it('deduplicates activity and projects bounded user and client summaries', async () => {
        vi.stubEnv('ACTIVITY_RECENT_APPLICATION_LIMIT', '1')
        vi.stubEnv('CLIENT_INACTIVE_AFTER_DAYS', '90')
        const adapter = new FakeKubernetesAdapter({namespace: 'apps'})
        adapter.seed('OIDCUser', rawUser())
        adapter.seed('OIDCClient', rawClient())
        globalThis.metrics = {oidcClientLastUsed: {set: vi.fn()}}
        const tracker = new ActivityTracker({adapter, now: () => new Date('2026-08-05T12:00:00.000Z')})
        tracker.registerClient(new OidcClient().fromIncomingClient(adapter.list('OIDCClient')[0]))
        tracker.record({
            accountId: 'alice', clientId: 'apps.grafana', clientNamespace: 'apps', clientName: 'grafana',
            timestamp: '2026-08-05T11:00:00.000Z',
        })
        tracker.record({
            accountId: 'alice', clientId: 'apps.grafana', clientNamespace: 'apps', clientName: 'grafana',
            timestamp: '2026-08-05T11:30:00.000Z',
        })

        await tracker.flush()

        const user = adapter.list('OIDCUser')[0]
        expect(user.status.recentApplications).toEqual([{
            clientId: 'apps.grafana', clientNamespace: 'apps', clientName: 'grafana',
            clientKind: 'OIDCClient',
            lastAuthenticatedAt: '2026-08-05T11:30:00.000Z',
        }])
        const client = adapter.list('OIDCClient')[0]
        expect(client.status.lastUsedAt).toBe('2026-08-05T11:30:00.000Z')
        expect(client.status.conditions.find(c => c.type === 'Inactive').status).toBe('False')
    })

    it('marks a never-used old client inactive', async () => {
        const adapter = new FakeKubernetesAdapter({namespace: 'apps'})
        adapter.seed('OIDCClient', rawClient())
        const tracker = new ActivityTracker({adapter, now: () => new Date('2026-08-05T12:00:00.000Z')})
        tracker.registerClient(new OidcClient().fromIncomingClient(adapter.list('OIDCClient')[0]))
        await tracker.flush()
        expect(adapter.list('OIDCClient')[0].status.conditions.find(c => c.type === 'Inactive').status).toBe('True')
    })

    it('continues flushing clients when one user projection fails', async () => {
        const adapter = new FakeKubernetesAdapter({namespace: 'apps'})
        adapter.seed('OIDCUser', rawUser())
        adapter.seed('OIDCClient', rawClient())
        const mutate = adapter.mutateNamespacedCustomObjectStatus.bind(adapter)
        adapter.mutateNamespacedCustomObjectStatus = vi.fn(async (kind, ...args) => {
            if (kind === 'OIDCUser') return undefined
            return mutate(kind, ...args)
        })
        const tracker = new ActivityTracker({adapter, now: () => new Date('2026-08-05T12:00:00.000Z')})
        tracker.registerClient(new OidcClient().fromIncomingClient(adapter.list('OIDCClient')[0]))
        tracker.record({
            accountId: 'alice', clientId: 'apps.grafana', clientNamespace: 'apps', clientName: 'grafana',
            timestamp: '2026-08-05T11:30:00.000Z',
        })

        await expect(tracker.flush()).rejects.toThrow('Failed to flush 1 OIDC activity projection')
        expect(adapter.list('OIDCClient')[0].status.lastUsedAt).toBe('2026-08-05T11:30:00.000Z')
    })

    it('preserves newer user activity recorded while a failed flush is in progress', async () => {
        const adapter = new FakeKubernetesAdapter({namespace: 'apps'})
        adapter.seed('OIDCUser', rawUser())
        adapter.seed('OIDCClient', rawClient())
        const mutate = adapter.mutateNamespacedCustomObjectStatus.bind(adapter)
        const tracker = new ActivityTracker({adapter})
        let fail = true
        adapter.mutateNamespacedCustomObjectStatus = vi.fn(async (kind, ...args) => {
            if (kind === 'OIDCUser' && fail) {
                tracker.record({
                    accountId: 'alice', clientId: 'apps.grafana', clientNamespace: 'apps', clientName: 'grafana',
                    timestamp: '2026-08-05T12:00:00.000Z',
                })
                return undefined
            }
            return mutate(kind, ...args)
        })
        tracker.record({
            accountId: 'alice', clientId: 'apps.grafana', clientNamespace: 'apps', clientName: 'grafana',
            timestamp: '2026-08-05T11:00:00.000Z',
        })
        await expect(tracker.flush()).rejects.toBeInstanceOf(AggregateError)

        fail = false
        await tracker.flush()
        expect(adapter.list('OIDCUser')[0].status.recentApplications[0].lastAuthenticatedAt)
            .toBe('2026-08-05T12:00:00.000Z')
    })

    it('preserves newer client activity recorded while its status write fails', async () => {
        const adapter = new FakeKubernetesAdapter({namespace: 'apps'})
        adapter.seed('OIDCClient', rawClient())
        const replace = adapter.replaceNamespacedCustomObjectStatus.bind(adapter)
        const tracker = new ActivityTracker({adapter})
        let fail = true
        adapter.replaceNamespacedCustomObjectStatus = vi.fn(async (kind, ...args) => {
            if (kind === 'OIDCClient' && fail) {
                tracker.record({
                    clientId: 'apps.grafana', clientNamespace: 'apps', clientName: 'grafana',
                    timestamp: '2026-08-05T12:00:00.000Z',
                })
                return undefined
            }
            return replace(kind, ...args)
        })
        tracker.record({
            clientId: 'apps.grafana', clientNamespace: 'apps', clientName: 'grafana',
            timestamp: '2026-08-05T11:00:00.000Z',
        })
        await expect(tracker.flush()).rejects.toBeInstanceOf(AggregateError)

        fail = false
        await tracker.flush()
        expect(adapter.list('OIDCClient')[0].status.lastUsedAt).toBe('2026-08-05T12:00:00.000Z')
    })

    it('removes the Prometheus series when a client is unregistered', () => {
        const adapter = new FakeKubernetesAdapter({namespace: 'apps'})
        adapter.seed('OIDCClient', rawClient())
        const remove = vi.fn()
        globalThis.metrics = {oidcClientLastUsed: {remove}}
        const tracker = new ActivityTracker({adapter})
        const client = new OidcClient().fromIncomingClient(adapter.list('OIDCClient')[0])
        tracker.registerClient(client)
        tracker.unregisterClient(client.getClientId())
        expect(remove).toHaveBeenCalledWith({kind: 'OIDCClient', namespace: 'apps', client: 'grafana'})
    })
})
