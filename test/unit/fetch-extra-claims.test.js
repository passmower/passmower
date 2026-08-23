import { describe, it, expect, vi, afterEach } from 'vitest'
import { fetchExtraClaims } from '../../src/utils/fetch-extra-claims.js'

afterEach(() => {
    vi.unstubAllEnvs()
    vi.unstubAllGlobals()
})

const ctx = { sub: 'u-test', groups: ['gh:org'], client_id: 'sample-rp', scope: 'openid namespaces' }

describe('fetchExtraClaims', () => {
    it('returns {} and makes no request when the URL is unset', async () => {
        const fetchMock = vi.fn()
        vi.stubGlobal('fetch', fetchMock)
        expect(await fetchExtraClaims(ctx)).toEqual({})
        expect(fetchMock).not.toHaveBeenCalled()
    })

    it('POSTs the caller context and returns the merged claims on success', async () => {
        vi.stubEnv('EXTRA_CLAIMS_WEBHOOK_URL', 'http://webhook.test/enrich')
        vi.stubEnv('EXTRA_CLAIMS_WEBHOOK_TOKEN', 'secret')
        const fetchMock = vi.fn().mockResolvedValue({
            ok: true,
            json: async () => ({ 'codemowers.io/namespaces': ['tenant-demo'] }),
        })
        vi.stubGlobal('fetch', fetchMock)

        const claims = await fetchExtraClaims(ctx)

        expect(claims).toEqual({ 'codemowers.io/namespaces': ['tenant-demo'] })
        const [url, opts] = fetchMock.mock.calls[0]
        expect(url).toBe('http://webhook.test/enrich')
        expect(opts.method).toBe('POST')
        expect(opts.headers.authorization).toBe('Bearer secret')
        expect(JSON.parse(opts.body)).toEqual(ctx)
    })

    it('fails open with {} on a non-OK response', async () => {
        vi.stubEnv('EXTRA_CLAIMS_WEBHOOK_URL', 'http://webhook.test/enrich')
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 503 }))
        vi.spyOn(console, 'error').mockImplementation(() => {})
        expect(await fetchExtraClaims(ctx)).toEqual({})
    })

    it('fails open with {} when the request throws', async () => {
        vi.stubEnv('EXTRA_CLAIMS_WEBHOOK_URL', 'http://webhook.test/enrich')
        vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('timeout')))
        vi.spyOn(console, 'error').mockImplementation(() => {})
        expect(await fetchExtraClaims(ctx)).toEqual({})
    })
})

describe('fetchExtraClaims protected-claims filter', () => {
    it('strips identity and authorization claims from the webhook response', async () => {
        vi.stubEnv('EXTRA_CLAIMS_WEBHOOK_URL', 'http://webhook.test/enrich')
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
            ok: true,
            json: async () => ({
                'codemowers.io/namespaces': ['tenant-demo'],
                sub: 'victim',
                groups: ['passmower:admins'],
                email_verified: true,
                aud: 'other-client',
            }),
        }))

        expect(await fetchExtraClaims(ctx)).toEqual({
            'codemowers.io/namespaces': ['tenant-demo'],
        })
    })

    it('rejects non-object payloads such as arrays', async () => {
        vi.stubEnv('EXTRA_CLAIMS_WEBHOOK_URL', 'http://webhook.test/enrich')
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
            ok: true,
            json: async () => (['not', 'claims']),
        }))
        expect(await fetchExtraClaims(ctx)).toEqual({})
    })
})
