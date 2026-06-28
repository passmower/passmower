import { describe, it, expect, beforeAll } from 'vitest'
import renderError from '../../src/utils/render-error.js'

beforeAll(() => {
    globalThis.logger ??= { info() {}, warn() {}, error() {}, debug() {}, trace() {} }
})

function render(out, oidc) {
    const ctx = { oidc }
    renderError(ctx, out, new Error(out.error))
    return ctx.body
}

describe('renderError', () => {
    it('shows the attempted and registered redirect URIs for invalid_redirect_uri (#75)', () => {
        const body = render(
            { error: 'invalid_redirect_uri', error_description: 'redirect_uri did not match any of the client\'s registered redirect_uris' },
            { params: { redirect_uri: 'https://evil.example/cb' }, client: { redirectUris: ['https://app.example/cb', 'https://app.example/cb2'] } },
        )
        expect(body).toContain('got: https://evil.example/cb')
        expect(body).toContain('registered: https://app.example/cb, https://app.example/cb2')
    })

    it('leaves other errors untouched', () => {
        const body = render({ error: 'access_denied', error_description: 'nope' }, {})
        expect(body).toContain('nope')
        expect(body).not.toContain('registered:')
    })

    it('does not break when oidc context is missing', () => {
        const body = render({ error: 'invalid_redirect_uri', error_description: 'mismatch' }, undefined)
        expect(body).toContain('mismatch')
    })
})
