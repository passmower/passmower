import {describe, expect, it} from 'vitest'
import {isUnprotectedRequest, unprotectedPathRules} from '../../src/utils/session/forward-auth-bypass.js'
import OIDCMiddlewareClient from '../../src/models/oidc-middleware-client.js'

const client = {
    unprotectedPaths: [
        {pathPrefix: '/hooks', methods: ['POST']},
        {pathPrefix: '/public/'},
    ],
}
const request = (uri, method = 'GET') => ({'x-forwarded-uri': uri, 'x-forwarded-method': method})
const open = (uri, method) => isUnprotectedRequest(client, request(uri, method))

// Unprotected forward-auth paths (#40). A match skips authentication, so the
// interesting cases are the ones that must not match.
describe('unprotected forward-auth paths', () => {
    it('matches a prefix by whole path segments', () => {
        expect(open('/hooks', 'POST')).toBe(true)
        expect(open('/hooks/github?delivery=1', 'POST')).toBe(true)
        expect(open('/public/logo.png')).toBe(true)
        expect(open('/hooks-admin', 'POST')).toBe(false)
        expect(open('/hooksadmin/x', 'POST')).toBe(false)
        expect(open('/public')).toBe(false)
        expect(open('/', 'POST')).toBe(false)
        expect(open('/admin/hooks', 'POST')).toBe(false)
    })

    it('honours the rule\'s methods', () => {
        expect(open('/hooks/github', 'GET')).toBe(false)
        expect(open('/hooks/github', 'post')).toBe(true)
        expect(open('/public/x', 'DELETE')).toBe(true)
        // No method from the proxy cannot satisfy a method-limited rule.
        expect(isUnprotectedRequest(client, {'x-forwarded-uri': '/hooks/github'})).toBe(false)
        expect(isUnprotectedRequest(client, {'x-forwarded-uri': '/public/x'})).toBe(true)
    })

    it('never matches a path a backend could resolve elsewhere', () => {
        for (const uri of [
            '/public/../admin',
            '/public/./../admin',
            '/public/%2e%2e/admin',
            '/public/%2E%2E%2Fadmin',
            '/public/..%2fadmin',
            '/public/%252e%252e/admin',
            '/public//admin',
            '/public/\\..\\admin',
            '/public/%5c..%5cadmin',
            '/public/x%00.png',
            'public/x',
            '//evil.example/public/x',
        ]) {
            expect(open(uri), uri).toBe(false)
        }
        // A query string is not part of the path, whatever it contains.
        expect(open('/public/x?next=/../admin')).toBe(true)
    })

    it('protects everything when nothing is declared', () => {
        expect(isUnprotectedRequest({}, request('/hooks', 'POST'))).toBe(false)
        expect(isUnprotectedRequest({unprotectedPaths: []}, request('/', 'GET'))).toBe(false)
        expect(isUnprotectedRequest(undefined, request('/', 'GET'))).toBe(false)
    })

    it('drops malformed rules instead of widening them', () => {
        expect(unprotectedPathRules([
            {pathPrefix: '/ok'},
            {pathPrefix: 'relative'},
            {pathPrefix: '/a/../b'},
            {pathPrefix: ''},
            {methods: ['POST']},
            null,
            'string',
        ])).toEqual([{pathPrefix: '/ok', methods: []}])
        expect(unprotectedPathRules('/everything')).toEqual([])
    })

    it('is carried from the resource into the stored client', () => {
        const stored = new OIDCMiddlewareClient().fromIncomingClient({
            metadata: {name: 'app', namespace: 'apps', uid: 'u'},
            spec: {uri: 'https://app.example.com', unprotectedPaths: client.unprotectedPaths},
        }).toRedis()
        expect(isUnprotectedRequest(stored, request('/hooks/x', 'POST'))).toBe(true)
        expect(new OIDCMiddlewareClient().fromIncomingClient({
            metadata: {name: 'app', namespace: 'apps', uid: 'u'}, spec: {uri: 'https://app.example.com'},
        }).toRedis().unprotectedPaths).toEqual([])
    })
})
