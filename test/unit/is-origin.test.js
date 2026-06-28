import { describe, it, expect } from 'vitest'
import isOrigin from '../../src/utils/session/is-origin.js'

describe('isOrigin', () => {
    it('accepts a bare origin', () => {
        expect(isOrigin('https://example.com')).toBe(true)
        expect(isOrigin('http://localhost:3000')).toBe(true)
        expect(isOrigin('https://example.com:8443')).toBe(true)
    })

    it('rejects URLs that carry a path, query or trailing slash', () => {
        expect(isOrigin('https://example.com/')).toBe(false)
        expect(isOrigin('https://example.com/path')).toBe(false)
        expect(isOrigin('https://example.com?a=1')).toBe(false)
    })

    it('rejects non-URLs and non-strings', () => {
        expect(isOrigin('not a url')).toBe(false)
        expect(isOrigin('')).toBe(false)
        expect(isOrigin(null)).toBe(false)
        expect(isOrigin(undefined)).toBe(false)
        expect(isOrigin(42)).toBe(false)
    })
})
