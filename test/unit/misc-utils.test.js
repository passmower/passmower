import { describe, it, expect } from 'vitest'
import kebabCase from '../../src/utils/kebab-case.js'
import sortObject from '../../src/utils/sort-object.js'

describe('kebabCase', () => {
    it('converts camelCase, spaces and underscores to kebab-case', () => {
        expect(kebabCase('fooBar')).toBe('foo-bar')
        expect(kebabCase('foo bar')).toBe('foo-bar')
        expect(kebabCase('foo_bar')).toBe('foo-bar')
        expect(kebabCase('Foo Bar_bazQux')).toBe('foo-bar-baz-qux')
    })
})

describe('sortObject', () => {
    it('returns a new object with keys in sorted order', () => {
        const sorted = sortObject({ c: 3, a: 1, b: 2 })
        expect(Object.keys(sorted)).toEqual(['a', 'b', 'c'])
        expect(sorted).toEqual({ a: 1, b: 2, c: 3 })
    })
})
