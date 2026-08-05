import {describe, expect, it, vi} from 'vitest';
import OidcClient from '../../src/models/oidc-client.js';
import OidcMiddlewareClient from '../../src/models/oidc-middleware-client.js';
import {ClientReconcileState} from '../../src/models/client-activity-state.js';

function resource(kind, {description = 'Initial', generation = 1, lastUsedAt} = {}) {
    return {
        metadata: {
            name: 'grafana', namespace: 'apps', resourceVersion: '1', generation,
            annotations: {'kubernetes.io/description': description},
        },
        spec: kind === 'OIDCClient' ? {
            grantTypes: ['authorization_code'], responseTypes: ['code'],
            redirectUris: ['https://grafana.example/callback'], availableScopes: ['openid'],
        } : {
            uri: 'https://grafana.example',
        },
        status: {instance: 'test', lastUsedAt},
    }
}

describe.each([
    ['OIDCClient', OidcClient],
    ['OIDCMiddlewareClient', OidcMiddlewareClient],
])('%s shared reconcile state', (kind, Model) => {
    it('ignores status-only changes but reconciles description annotations', () => {
        const tracker = {registerClient: vi.fn(), unregisterClient: vi.fn()}
        const state = new ClientReconcileState(tracker)
        state.register(new Model().fromIncomingClient(resource(kind)))

        expect(state.shouldReconcile(new Model().fromIncomingClient(resource(kind, {
            lastUsedAt: '2026-08-05T12:00:00.000Z',
        })))).toBe(false)
        expect(state.shouldReconcile(new Model().fromIncomingClient(resource(kind, {
            description: 'Updated',
            lastUsedAt: '2026-08-05T12:00:00.000Z',
        })))).toBe(true)
    })
})
