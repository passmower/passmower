import {describe, expect, it} from 'vitest';
import KubeScimConnectionOperator from '../../src/operators/kube-scim-connection-operator.js';
import {FakeKubernetesAdapter} from '../fakes/fake-kubernetes-adapter.js';

describe('SCIM connection revocation', () => {
    it('removes only the disabled connection projection from linked accounts', async () => {
        const adapter = new FakeKubernetesAdapter();
        adapter.seed('SCIMConnection', {
            metadata: {name: 'acme', uid: 'uid-acme'},
            spec: {
                group: {prefix: 'codemowers', name: 'org-acme'},
                grantMode: 'all-users',
                tokenHashes: ['0'.repeat(64)],
                disabled: true,
            },
        });
        adapter.seed('SCIMSubject', {
            metadata: {name: 'subject-alice'},
            spec: {
                connectionRef: 'acme',
                connectionUid: 'uid-acme',
                identity: {externalId: 'entra-alice', active: true, groups: [{prefix: 'codemowers', name: 'org-acme'}]},
            },
            status: {accountId: 'alice'},
        });
        adapter.seed('OIDCUser', {
            metadata: {name: 'alice'},
            spec: {type: 'person', groups: [{prefix: 'native', name: 'support'}]},
            identities: {
                'scim-uid-acme': {sub: 'entra-alice', active: true, groups: [{prefix: 'codemowers', name: 'org-acme'}]},
                entra: {sub: 'interactive-identity', groups: [{prefix: 'entra', name: 'employees'}]},
            },
        });

        const operator = new KubeScimConnectionOperator(adapter);
        await operator.watchConnections();
        await adapter.fireWatch('MODIFIED', 'SCIMConnection', 'acme');

        const account = adapter.list('OIDCUser')[0];
        expect(account.identities['scim-uid-acme']).toEqual({sub: 'entra-alice', active: false, groups: []});
        expect(account.identities.entra.groups).toEqual([{prefix: 'entra', name: 'employees'}]);
        expect(account.spec.groups).toEqual([{prefix: 'native', name: 'support'}]);
        expect(account.status.groups).toEqual([
            {prefix: 'native', name: 'support'},
            {prefix: 'entra', name: 'employees'},
        ]);
        const connection = adapter.list('SCIMConnection')[0];
        expect(connection.status).toEqual({
            userCount: 1,
            groupCount: 0,
            conditions: [{type: 'Ready', status: 'False', reason: 'Disabled'}],
        });
    });
});
