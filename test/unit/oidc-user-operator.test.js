import {beforeAll, describe, expect, it, vi} from 'vitest';
import KubeOIDCUserOperator from '../../src/operators/kube-oidc-user-operator.js';
import {FakeKubernetesAdapter} from '../fakes/fake-kubernetes-adapter.js';

beforeAll(() => {
    globalThis.logger ??= {info() {}, warn() {}, error() {}, debug() {}}
})

describe('KubeOIDCUserOperator email reconciliation', () => {
    it('coalesces a burst of user events into at most one follow-up pass', async () => {
        const adapter = new FakeKubernetesAdapter()
        const operator = new KubeOIDCUserOperator({}, adapter)
        await operator.watchUsers()
        for (const name of ['one', 'two', 'three']) {
            adapter.seed('OIDCUser', {
                metadata: {name, creationTimestamp: '2026-01-01T00:00:00Z'},
                spec: {email: `${name}@example.com`},
            })
        }
        let releaseFirst
        const reconcile = vi.spyOn(operator.userService, 'reconcileEmailUniqueness')
            .mockImplementationOnce(() => new Promise(resolve => { releaseFirst = resolve }))
            .mockResolvedValue({})

        const events = ['one', 'two', 'three'].map(name => adapter.fireWatch('ADDED', 'OIDCUser', name))
        await vi.waitFor(() => expect(reconcile).toHaveBeenCalledTimes(1))
        releaseFirst({})
        await Promise.all(events)

        expect(reconcile).toHaveBeenCalledTimes(2)
    })
})
