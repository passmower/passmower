import {describe, expect, it} from 'vitest'
import OIDCMiddlewareClient from '../../src/models/oidc-middleware-client.js'

describe('OIDCMiddlewareClient user ACL', () => {
    it('projects allowed users into provider metadata', () => {
        const client = new OIDCMiddlewareClient().fromIncomingClient({
            metadata: {name: 'webmail', namespace: 'apps', resourceVersion: '1', uid: 'uid-1'},
            spec: {allowedUsers: ['alice', 'bob']},
            status: {},
        })

        expect(client.toRedis().allowedUsers).toEqual(['alice', 'bob'])
    })
})

describe('OIDCMiddlewareClient Traefik middleware', () => {
    it('lists only the mapped headers, leaving out ones set to an empty string', () => {
        const client = new OIDCMiddlewareClient().fromIncomingClient({
            metadata: {name: 'webmail', namespace: 'apps', resourceVersion: '1', uid: 'uid-1'},
            spec: {headerMapping: {user: 'Remote-User', email: 'Remote-Email', emailVerified: ''}},
            status: {},
        })

        expect(client.toMiddlewareSpec('passmower', 'passmower').forwardAuth.authResponseHeaders)
            .toEqual(['Remote-User', 'Remote-Email'])
    })
})
