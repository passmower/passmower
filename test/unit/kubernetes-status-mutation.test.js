import {beforeEach, describe, expect, it, vi} from 'vitest'
import {KubernetesAdapter} from '../../src/adapters/kubernetes.js'

describe('semantic Kubernetes status mutations', () => {
    let adapter

    beforeEach(() => {
        globalThis.logger = {error: vi.fn(), warn: vi.fn()}
        adapter = Object.create(KubernetesAdapter.prototype)
        adapter.defaultOptions = {}
    })

    it('re-reads and recomputes the mutation after a resourceVersion conflict', async () => {
        const before = {
            metadata: {name: 'alice', resourceVersion: '1'},
            status: {conditions: [{type: 'Approved'}]},
        }
        const concurrentlyUpdated = {
            metadata: {name: 'alice', resourceVersion: '2'},
            status: {
                conditions: [{type: 'Approved'}],
                recentApplications: [{clientId: 'grafana'}],
            },
        }
        const replace = vi.fn()
            .mockRejectedValueOnce(Object.assign(new Error('Conflict'), {code: 409}))
            .mockImplementationOnce(({body}) => ({...concurrentlyUpdated, status: body.status}))
        adapter.customObjectsApi = {
            getNamespacedCustomObject: vi.fn()
                .mockResolvedValueOnce(before)
                .mockResolvedValueOnce(concurrentlyUpdated),
            replaceNamespacedCustomObjectStatus: replace,
        }
        const statusFunction = vi.fn(resource => ({
            ...resource.status,
            conditions: [...resource.status.conditions, {type: 'EmailUnique'}],
        }))

        const result = await adapter.mutateNamespacedCustomObjectStatus(
            'OIDCUser', 'users', 'alice', value => structuredClone(value), statusFunction,
        )

        expect(statusFunction).toHaveBeenCalledTimes(2)
        expect(replace.mock.calls[1][0].body).toMatchObject({
            metadata: {resourceVersion: '2'},
            status: {
                conditions: [{type: 'Approved'}, {type: 'EmailUnique'}],
                recentApplications: [{clientId: 'grafana'}],
            },
        })
        expect(result.status.recentApplications).toEqual([{clientId: 'grafana'}])
        expect(globalThis.logger.warn).toHaveBeenCalledOnce()
    })

    it('stops after three conflicting recomputations', async () => {
        const conflict = Object.assign(new Error('Conflict'), {code: 409})
        adapter.customObjectsApi = {
            getNamespacedCustomObject: vi.fn()
                .mockResolvedValueOnce({metadata: {resourceVersion: '1'}, status: {}})
                .mockResolvedValueOnce({metadata: {resourceVersion: '2'}, status: {}})
                .mockResolvedValueOnce({metadata: {resourceVersion: '3'}, status: {}}),
            replaceNamespacedCustomObjectStatus: vi.fn().mockRejectedValue(conflict),
        }
        const statusFunction = vi.fn(resource => ({...resource.status, reconciled: true}))

        const result = await adapter.mutateNamespacedCustomObjectStatus(
            'OIDCUser', 'users', 'alice', value => value, statusFunction,
        )

        expect(result).toBeUndefined()
        expect(statusFunction).toHaveBeenCalledTimes(3)
        expect(globalThis.logger.error).toHaveBeenCalledWith(conflict)
    })

    it('returns null without logging when the resource disappears', async () => {
        const gone = Object.assign(new Error('Not Found'), {code: 404})
        adapter.customObjectsApi = {
            getNamespacedCustomObject: vi.fn().mockRejectedValue(gone),
            replaceNamespacedCustomObjectStatus: vi.fn(),
        }

        const result = await adapter.mutateNamespacedCustomObjectStatus(
            'OIDCUser', 'users', 'alice', value => value, resource => resource.status,
        )

        expect(result).toBeNull()
        expect(globalThis.logger.error).not.toHaveBeenCalled()
        expect(adapter.customObjectsApi.replaceNamespacedCustomObjectStatus).not.toHaveBeenCalled()
    })

    it('skips a status write when the recomputed status is unchanged', async () => {
        const current = {
            metadata: {name: 'alice', resourceVersion: '7'},
            status: {conditions: [{type: 'Approved', status: 'True'}]},
        }
        adapter.customObjectsApi = {
            getNamespacedCustomObject: vi.fn().mockResolvedValue(current),
            replaceNamespacedCustomObjectStatus: vi.fn(),
        }

        const result = await adapter.mutateNamespacedCustomObjectStatus(
            'OIDCUser', 'users', 'alice', value => structuredClone(value), resource => resource.status,
        )

        expect(result).toEqual(current)
        expect(adapter.customObjectsApi.replaceNamespacedCustomObjectStatus).not.toHaveBeenCalled()
    })
})
