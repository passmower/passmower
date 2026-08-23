import { describe, it, expect } from 'vitest'
import { isSafeDisplayName } from '../../src/utils/session/validator.js'

// Regression for #64: names/companies pulled from upstream IdPs (GitHub, OIDC)
// contain unicode that the old en-US alphanumeric allowlist rejected, so an edit
// of a pulled-in value failed validation. We now accept printable input and only
// reject genuinely unsafe characters.
describe('isSafeDisplayName (#64)', () => {
    it('accepts unicode letters, accents, punctuation that upstreams supply', () => {
        for (const name of [
            'Søren Kierkegaard',
            'José Núñez',
            "O'Brien",
            'Jean-Luc Picard',
            'Müller & Sons',
            'Łukasz Żółć',
            '山田 太郎',
            'Acme, Inc.',
        ]) {
            expect(isSafeDisplayName(name), name).toBe(true)
        }
    })

    it('rejects angle brackets (markup injection)', () => {
        expect(isSafeDisplayName('<script>alert(1)</script>')).toBe(false)
        expect(isSafeDisplayName('a < b')).toBe(false)
        expect(isSafeDisplayName('x > y')).toBe(false)
    })

    it('rejects control characters incl. newlines (header injection)', () => {
        expect(isSafeDisplayName('Evil\nRemote-Groups: admins')).toBe(false)
        expect(isSafeDisplayName('a\tb')).toBe(false)
        expect(isSafeDisplayName('a\r\nb')).toBe(false)
        expect(isSafeDisplayName('a\x00b')).toBe(false)
    })

    it('treats empty/nullish as safe (length is enforced separately)', () => {
        expect(isSafeDisplayName('')).toBe(true)
        expect(isSafeDisplayName(null)).toBe(true)
        expect(isSafeDisplayName(undefined)).toBe(true)
    })
})
