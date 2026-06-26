import { describe, it, expect } from 'vitest'
import { sanitizeUsername, isUsernameValid } from '../../src/utils/user/username.js'

describe('sanitizeUsername', () => {
    it('takes the local part of an email and strips non-alphanumerics', () => {
        expect(sanitizeUsername('John.Doe@example.com')).toBe('johndoe')
        expect(sanitizeUsername('a-b_c.d')).toBe('abcd')
    })

    it('drops leading digits so the result starts with a letter', () => {
        expect(sanitizeUsername('123abc')).toBe('abc')
    })

    it('caps length at 15 characters', () => {
        expect(sanitizeUsername('averylongusernamewaytoolong')).toHaveLength(15)
    })

    it('returns null when nothing usable remains', () => {
        expect(sanitizeUsername('!!!')).toBeNull()
        expect(sanitizeUsername('12345')).toBeNull()
        expect(sanitizeUsername('')).toBeNull()
        expect(sanitizeUsername(null)).toBeNull()
    })
})

describe('isUsernameValid', () => {
    it('accepts a well-formed username', () => {
        expect(isUsernameValid('johndoe')).toBe(true)
    })

    it('rejects on each individual rule', () => {
        expect(isUsernameValid('jo')).toBe(false)              // too short
        expect(isUsernameValid('johndoeexceeds')).toBe(true)   // 14 chars, still ok
        expect(isUsernameValid('johndoeexceedsxx')).toBe(false) // 16 chars, too long
        expect(isUsernameValid('john.doe')).toBe(false)        // not alphanumeric
        expect(isUsernameValid('1johndoe')).toBe(false)        // must start with a letter
        expect(isUsernameValid('JohnDoe')).toBe(false)         // must be lowercase
    })

    it('rejects falsy input', () => {
        expect(isUsernameValid('')).toBe(false)
        expect(isUsernameValid(null)).toBe(false)
        expect(isUsernameValid(undefined)).toBe(false)
    })
})
