import {describe, it, expect} from 'vitest'
import {clientOrigin, clientUri} from '../../src/utils/kubernetes/client-uri.js'

describe('clientUri', () => {
    it.each([
        ['https://app.example.com', 'https://app.example.com'],
        ['https://app.example.com/', 'https://app.example.com'],
        ['https://app.example.com///', 'https://app.example.com'],
        ['  https://app.example.com/  ', 'https://app.example.com'],
        ['https://app.example.com/gallery', 'https://app.example.com/gallery'],
        ['https://app.example.com/a?b=c', 'https://app.example.com/a?b=c'],
    ])('normalises %s to %s', (uri, expected) => {
        expect(clientUri(uri)).toBe(expected)
    })

    it.each([undefined, null, ''])('returns an empty string for %s', (uri) => {
        expect(clientUri(uri)).toBe('')
    })

    it('does not round-trip through URL, which would add a trailing slash', () => {
        // The whole reason this is string work: the normalised form of a bare
        // origin gains a slash that the consuming application then treats as
        // part of the path (#268).
        expect(new URL('https://app.example.com').href).toBe('https://app.example.com/')
        expect(clientUri('https://app.example.com')).toBe('https://app.example.com')
    })
})

describe('clientOrigin', () => {
    it.each([
        ['https://app.example.com/gallery/index.html', 'https://app.example.com'],
        ['https://app.example.com:8443/a/b', 'https://app.example.com:8443'],
        ['https://app.example.com/a?b=c#d', 'https://app.example.com'],
        ['http://localhost:3000/', 'http://localhost:3000'],
    ])('reduces %s to %s', (uri, expected) => {
        expect(clientOrigin(uri)).toBe(expected)
    })

    it.each([undefined, null, ''])('returns an empty string for %s', (uri) => {
        expect(clientOrigin(uri)).toBe('')
    })

    it.each([
        // A native client's custom scheme has no meaningful origin — URL
        // serialises it as the string "null", which is worse than empty.
        'app.immich:///oauth-callback',
        'not a url',
    ])('returns an empty string rather than "null" for %s', (uri) => {
        expect(clientOrigin(uri)).toBe('')
    })
})
