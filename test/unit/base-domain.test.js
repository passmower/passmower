import { describe, it, expect } from 'vitest'
import { getUrlsInProviderBaseDomain, isHostInProviderBaseDomain, providerBaseDomain } from '../../src/utils/session/base-domain.js'

describe('isHostInProviderBaseDomain', () => {
    it('accepts the base domain and its subdomains', () => {
        expect(isHostInProviderBaseDomain('example.com', 'example.com')).toBe(true)
        expect(isHostInProviderBaseDomain('app.example.com', 'example.com')).toBe(true)
        expect(isHostInProviderBaseDomain('a.b.example.com', 'example.com')).toBe(true)
        expect(isHostInProviderBaseDomain('App.Example.COM.', 'example.com')).toBe(true)
    })

    it('rejects look-alike domains that merely end with the base domain', () => {
        expect(isHostInProviderBaseDomain('evilexample.com', 'example.com')).toBe(false)
        expect(isHostInProviderBaseDomain('app.evilexample.com', 'example.com')).toBe(false)
        expect(isHostInProviderBaseDomain('example.com.evil.net', 'example.com')).toBe(false)
    })

    it('rejects missing hosts', () => {
        expect(isHostInProviderBaseDomain(undefined, 'example.com')).toBe(false)
        expect(isHostInProviderBaseDomain('', 'example.com')).toBe(false)
    })

    it('defaults to the base domain of ISSUER_URL', () => {
        expect(providerBaseDomain).toBe('example.com')
        expect(isHostInProviderBaseDomain('app.example.com')).toBe(true)
        expect(isHostInProviderBaseDomain('evilexample.com')).toBe(false)
    })
})

describe('getUrlsInProviderBaseDomain', () => {
    it('keeps only redirect URIs in the provider base domain', () => {
        expect(getUrlsInProviderBaseDomain([
            'https://app.example.com/cb',
            'https://evilexample.com/cb',
            'https://example.org/cb',
        ])).toEqual(['https://app.example.com/cb'])
    })
})
