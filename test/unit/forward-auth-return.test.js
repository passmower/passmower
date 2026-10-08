import { describe, it, expect, vi } from 'vitest'

const config = vi.hoisted(() => ({
    cookies: {keys: ['new-key-0123456789abcdef0123456789', 'old-key-0123456789abcdef0123456789']},
    ttl: {Interaction: 3600},
}))
vi.mock('oidc-provider/lib/helpers/weak_cache.js', () => ({default: () => ({configuration: config})}))

import {
    forwardAuthRedirectUri,
    requestedUrl,
    signReturnState,
    verifyReturnState,
} from '../../src/utils/session/forward-auth-return.js'

// ISSUER_URL is https://oidc.test.example.com/ (test/setup/env.js), so the
// provider base domain is example.com.
const provider = {}
const headers = (overrides = {}) => ({
    'x-forwarded-proto': 'https',
    'x-forwarded-host': 'app.example.com',
    'x-forwarded-uri': '/inbox?folder=1',
    ...overrides,
})

describe('forwardAuthRedirectUri', () => {
    it('is a fixed endpoint on the issuer', () => {
        expect(forwardAuthRedirectUri()).toBe('https://oidc.test.example.com/forward-auth/return')
    })
})

describe('requestedUrl', () => {
    it('rebuilds the page the proxy was asked for', () => {
        expect(requestedUrl(headers()).href).toBe('https://app.example.com/inbox?folder=1')
        expect(requestedUrl(headers({'x-forwarded-host': 'app.example.com:8443'})).href)
            .toBe('https://app.example.com:8443/inbox?folder=1')
        expect(requestedUrl(headers({'x-forwarded-uri': undefined})).href).toBe('https://app.example.com/')
    })

    it('takes the port from X-Forwarded-Port when the host carries none', () => {
        expect(requestedUrl(headers({'x-forwarded-port': '8443'})).href).toBe('https://app.example.com:8443/inbox?folder=1')
        expect(requestedUrl(headers({'x-forwarded-port': '443'})).href).toBe('https://app.example.com/inbox?folder=1')
        expect(requestedUrl(headers({'x-forwarded-host': 'app.example.com:9000', 'x-forwarded-port': '8443'})).port).toBe('9000')
    })

    it('keeps a bracketed IPv6 host intact for the base-domain check', () => {
        // The test issuer is under example.com, so [::1] is refused there; what
        // matters is that it reaches that check as a host and is not thrown out
        // as malformed beforehand.
        expect(requestedUrl(headers({'x-forwarded-host': '[::1]:8443'}))).toBeUndefined()
        expect(requestedUrl(headers({'x-forwarded-host': '[::1]:8443', 'x-forwarded-port': '9000'}))).toBeUndefined()
    })

    it('ignores the RFC 7239 Forwarded header', () => {
        expect(requestedUrl(headers({forwarded: 'host=evilexample.com;proto=https'})).hostname)
            .toBe('app.example.com')
    })

    it('rejects hosts outside the provider base domain', () => {
        expect(requestedUrl(headers({'x-forwarded-host': 'evilexample.com'}))).toBeUndefined()
        expect(requestedUrl(headers({'x-forwarded-host': 'example.org'}))).toBeUndefined()
    })

    it('rejects hosts and paths that would change the URL authority', () => {
        expect(requestedUrl(headers({'x-forwarded-host': 'evil.com@app.example.com'}))).toBeUndefined()
        expect(requestedUrl(headers({'x-forwarded-host': 'app.example.com/x'}))).toBeUndefined()
        expect(requestedUrl(headers({'x-forwarded-host': 'app.example.com?x'}))).toBeUndefined()
        expect(requestedUrl(headers({'x-forwarded-uri': 'evil.com/x'}))).toBeUndefined()
        expect(requestedUrl(headers({'x-forwarded-uri': '//evilexample.com/x'})).hostname).toBe('app.example.com')
    })

    it('rejects non-http schemes and a missing host', () => {
        expect(requestedUrl(headers({'x-forwarded-proto': 'javascript'}))).toBeUndefined()
        expect(requestedUrl(headers({'x-forwarded-host': undefined}))).toBeUndefined()
    })
})

describe('return state', () => {
    const url = new URL('https://app.example.com/inbox')

    it('round-trips the return URL', () => {
        expect(verifyReturnState(provider, signReturnState(provider, url))).toBe('https://app.example.com/inbox')
    })

    it('verifies against every current cookie key', () => {
        const state = signReturnState(provider, url)
        config.cookies.keys.reverse()
        try {
            expect(verifyReturnState(provider, state)).toBe('https://app.example.com/inbox')
        } finally {
            config.cookies.keys.reverse()
        }
    })

    it('rejects tampered, foreign and malformed states', () => {
        const [payload, signature] = signReturnState(provider, url).split('.')
        const forged = Buffer.from(JSON.stringify({
            u: 'https://evilexample.com/', e: Math.floor(Date.now() / 1000) + 60,
        })).toString('base64url')
        expect(verifyReturnState(provider, `${forged}.${signature}`)).toBeUndefined()
        expect(verifyReturnState(provider, `${payload}.${signature.slice(1)}x`)).toBeUndefined()
        expect(verifyReturnState(provider, payload)).toBeUndefined()
        expect(verifyReturnState(provider, undefined)).toBeUndefined()
        expect(verifyReturnState(provider, ['a.b'])).toBeUndefined()
    })

    it('expires with the interaction', () => {
        const state = signReturnState(provider, url, Date.now() - 2 * 3600 * 1000)
        expect(verifyReturnState(provider, state)).toBeUndefined()
    })
})
