import {beforeEach, describe, expect, it, vi} from 'vitest'
import {KubernetesAdapter} from '../../src/adapters/kubernetes.js'

describe('Kubernetes status conflict handling', () => {
    let adapter

    beforeEach(() => {
        globalThis.logger = {error: vi.fn(), warn: vi.fn()}
        adapter = Object.create(KubernetesAdapter.prototype)
        adapter.defaultOptions = {}
    })

    it('retries a conflicted status update with the latest resource version', async () => {
        const replace = vi.fn()
            .mockRejectedValueOnce(Object.assign(new Error('Conflict'), {code: 409}))
            .mockResolvedValue({metadata: {name: 'alice', resourceVersion: '3'}})
        adapter.customObjectsApi = {
            replaceNamespacedCustomObjectStatus: replace,
            getNamespacedCustomObject: vi.fn().mockResolvedValue({metadata: {resourceVersion: '2'}}),
        }

        const result = await adapter.replaceNamespacedCustomObjectStatus(
            'OIDCUser', 'users', 'alice', '1', {primaryEmail: 'alice@example.com'}, value => value,
        )

        expect(result.metadata.resourceVersion).toBe('3')
        expect(replace).toHaveBeenCalledTimes(2)
        expect(replace.mock.calls[1][0].body.metadata.resourceVersion).toBe('2')
        expect(globalThis.logger.warn).toHaveBeenCalledOnce()
        expect(globalThis.logger.error).not.toHaveBeenCalled()
    })

    it('bounds repeated conflicts and reports the final failure', async () => {
        const conflict = Object.assign(new Error('Conflict'), {code: 409})
        adapter.customObjectsApi = {
            replaceNamespacedCustomObjectStatus: vi.fn().mockRejectedValue(conflict),
            getNamespacedCustomObject: vi.fn()
                .mockResolvedValueOnce({metadata: {resourceVersion: '2'}})
                .mockResolvedValueOnce({metadata: {resourceVersion: '3'}}),
        }

        const result = await adapter.replaceNamespacedCustomObjectStatus(
            'OIDCUser', 'users', 'alice', '1', {}, value => value,
        )

        expect(result).toBeUndefined()
        expect(adapter.customObjectsApi.replaceNamespacedCustomObjectStatus).toHaveBeenCalledTimes(3)
        expect(globalThis.logger.error).toHaveBeenCalledWith(conflict)
    })
})
