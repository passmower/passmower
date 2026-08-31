import {afterAll, beforeAll, beforeEach, describe, expect, it, vi} from 'vitest'
import {fileURLToPath} from 'node:url'
import {KubernetesAdapter} from '../../src/adapters/kubernetes.js'

// The client operator treats a falsy return from these as a reconcile failure
// (#createKubeSecret / #patchKubeSecret), and the fake adapter always resolves
// the secret it stored — so only a test against the real adapter catches a
// dropped `return`. createSecret shipped without one: every freshly created
// OIDCClient reported SecretReconcileFailed and never reached
// redisAdapter.upsert(), leaving it absent from Redis (and so unusable at the
// authorization endpoint) until its spec was next edited, even though its
// Secret had been written correctly.
describe('Kubernetes Secret reconciliation', () => {
    let adapter
    const secretName = 'oidc-client-grafana-owner-secrets'
    const data = {
        OIDC_CLIENT_ID: 'default.grafana',
        OIDC_GRANT_TYPES: ['authorization_code'],
    }

    // A real instance, not Object.create: createSecret/patchSecret call the
    // adapter's private #generateSecretData / #parseSecretData, and private
    // members brand-check the receiver.
    const kubeconfig = process.env.KUBECONFIG
    beforeAll(() => {
        process.env.KUBECONFIG = fileURLToPath(new URL('../fixtures/kubeconfig.yaml', import.meta.url))
    })
    afterAll(() => {
        if (kubeconfig === undefined) delete process.env.KUBECONFIG
        else process.env.KUBECONFIG = kubeconfig
    })

    beforeEach(() => {
        globalThis.logger = {error: vi.fn()}
        adapter = new KubernetesAdapter()
    })

    it('resolves the created Secret data so the operator can report Ready', async () => {
        adapter.coreV1Api = {
            createNamespacedSecret: vi.fn().mockImplementation(async ({body}) => ({data: body.data})),
        }

        await expect(adapter.createSecret('default', secretName, data, {})).resolves.toEqual(data)
        const {body} = adapter.coreV1Api.createNamespacedSecret.mock.calls[0][0]
        expect(body.metadata.name).toBe(secretName)
        expect(body.data.OIDC_CLIENT_ID).toBe(Buffer.from('default.grafana').toString('base64'))
    })

    it('resolves the patched Secret data', async () => {
        adapter.coreV1Api = {
            patchNamespacedSecret: vi.fn().mockResolvedValue({
                data: {OIDC_CLIENT_ID: Buffer.from('default.grafana').toString('base64')},
            }),
        }

        await expect(adapter.patchSecret('default', secretName, data, {}, {metadata: {}, data: {}}))
            .resolves.toEqual({OIDC_CLIENT_ID: 'default.grafana'})
    })

    it('resolves null and logs when the API rejects the create', async () => {
        const forbidden = Object.assign(new Error('Forbidden'), {code: 403})
        adapter.coreV1Api = {createNamespacedSecret: vi.fn().mockRejectedValue(forbidden)}

        await expect(adapter.createSecret('default', secretName, data, {})).resolves.toBeNull()
        expect(globalThis.logger.error).toHaveBeenCalledWith(forbidden)
    })
})
