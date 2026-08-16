import {beforeEach, describe, expect, it, vi} from 'vitest'
import {KubernetesAdapter} from '../../src/adapters/kubernetes.js'

describe('Kubernetes Job creation', () => {
    let adapter
    const job = {metadata: {name: 'deterministic-hook-job'}}

    beforeEach(() => {
        globalThis.logger = {error: vi.fn()}
        adapter = Object.create(KubernetesAdapter.prototype)
        adapter.defaultOptions = {}
    })

    it('treats an existing deterministic Job as a successful replay', async () => {
        adapter.batchV1Api = {
            createNamespacedJob: vi.fn().mockRejectedValue(Object.assign(new Error('Already exists'), {code: 409})),
        }

        await expect(adapter.createJob('users', job, {ignoreAlreadyExists: true}))
            .resolves.toEqual({alreadyExists: true})
        expect(globalThis.logger.error).not.toHaveBeenCalled()
    })

    it('continues surfacing other Job creation failures', async () => {
        const forbidden = Object.assign(new Error('Forbidden'), {code: 403})
        adapter.batchV1Api = {createNamespacedJob: vi.fn().mockRejectedValue(forbidden)}

        await expect(adapter.createJob('users', job, {ignoreAlreadyExists: true})).resolves.toBeNull()
        expect(globalThis.logger.error).toHaveBeenCalledWith(
            {err: forbidden, job: 'deterministic-hook-job'}, 'Failed to create Kubernetes Job',
        )
    })
})
