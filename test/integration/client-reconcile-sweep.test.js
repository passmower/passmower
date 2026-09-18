import {describe, it, expect, beforeAll, afterAll, beforeEach, vi} from 'vitest'

// Replace the Kubernetes adapter before the app is imported.
vi.mock('../../src/adapters/kubernetes.js', () => import('../fakes/shared-kube.js'))

import {fakeKube} from '../fakes/shared-kube.js'
import {OIDCClientCrd, OIDCMiddlewareClientCrd} from '../../src/utils/kubernetes/kube-constants.js'

// The sweep against a real Redis, where removing a record means keeping the
// 'Clients' set in step with it — the set is what getEnrolledApps() reads, and
// a record and its set membership can go stale independently (#257).
describe('client reconcile sweep against Redis', () => {
    let clientRedis, clientsRedis, reconciler, getEnrolledApps

    const seedClient = (name) => fakeKube.seed(OIDCClientCrd, {
        metadata: {name, namespace: 'test', labels: {}},
        spec: {
            grantTypes: ['authorization_code'], responseTypes: ['code'],
            redirectUris: [`https://${name}.test/callback`], availableScopes: ['openid'],
        },
    })

    const record = (name, kind = OIDCClientCrd) => ({
        client_id: `test.${name}`,
        client_name: name,
        clientNamespace: 'test',
        displayName: name,
        uri: `https://${name}.test/`,
        allowedGroups: [],
        kind,
    })

    beforeAll(async () => {
        process.env.REDIS_URI ??= 'redis://127.0.0.1:6379'
        globalThis.logger = {debug() {}, info() {}, warn() {}, error() {}, trace() {}}

        const {default: RedisAdapter} = await import('../../src/adapters/redis.js')
        clientRedis = new RedisAdapter('Client')
        clientsRedis = new RedisAdapter('Clients')
        const {ClientRedisReconciler} = await import('../../src/services/client-redis-reconciler.js')
        reconciler = new ClientRedisReconciler()
        ;({getEnrolledApps} = await import('../../src/utils/apps/list-apps.js'))
    })

    beforeEach(async () => {
        for (const id of await clientsRedis.getSetMembers(1)) {
            await clientRedis.destroy(id)
        }
        fakeKube.store.clear()
    })

    afterAll(async () => {
        for (const id of await clientsRedis.getSetMembers(1)) {
            await clientRedis.destroy(id)
        }
        const {disconnect} = await import('../../src/adapters/redis.js')
        await disconnect()
    })

    it('drops a deleted client out of the enrolled apps list', async () => {
        seedClient('kept')
        await clientRedis.upsert('test.kept', record('kept'))
        await clientRedis.upsert('test.gone', record('gone'))

        expect((await getEnrolledApps()).map(c => c.client_id).sort())
            .toEqual(['test.gone', 'test.kept'])

        expect(await reconciler.sweep()).toEqual(['test.gone'])

        expect((await getEnrolledApps()).map(c => c.client_id)).toEqual(['test.kept'])
        // Removed from the set too, not just the key — a member left behind
        // makes every later read do a pointless lookup for a missing record.
        expect(await clientsRedis.getSetMembers(1)).toEqual(['test.kept'])
    })

    it('leaves a middleware client alone while sweeping OIDC clients', async () => {
        fakeKube.seed(OIDCMiddlewareClientCrd, {
            metadata: {name: 'wiki', namespace: 'test', labels: {}},
            spec: {uri: 'https://wiki.test/', headerMapping: {}},
        })
        await clientRedis.upsert('middleware-test.wiki', {
            ...record('wiki', OIDCMiddlewareClientCrd),
            client_id: 'middleware-test.wiki',
        })
        await clientRedis.upsert('test.gone', record('gone'))

        expect(await reconciler.sweep()).toEqual(['test.gone'])
        expect(await clientRedis.find('middleware-test.wiki')).toBeTruthy()
    })

    // The set and the records drift apart independently: destroy() has to fall
    // back to the default owner to remove a member whose record is already gone.
    it('removes a set member whose record has vanished', async () => {
        await clientRedis.upsert('test.orphan', record('orphan'))
        await clientsRedis.appendToSet(1, 'test.ghost')

        const removed = await reconciler.sweep()

        expect(removed.sort()).toEqual(['test.ghost', 'test.orphan'])
        expect(await clientsRedis.getSetMembers(1)).toEqual([])
    })

    it('keeps everything when the cluster is unreachable', async () => {
        await clientRedis.upsert('test.kept', record('kept'))
        const list = fakeKube.listNamespacedCustomObject.bind(fakeKube)
        fakeKube.listNamespacedCustomObject = async () => null
        try {
            expect(await reconciler.sweep()).toEqual([])
        } finally {
            fakeKube.listNamespacedCustomObject = list
        }
        expect(await clientRedis.find('test.kept')).toBeTruthy()
    })
})
