import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest'
import request from 'supertest'
import { createHash, randomBytes } from 'node:crypto'

// Replace the Kubernetes adapter and email adapter before the app is imported.
vi.mock('../../src/adapters/kubernetes.js', () => import('../fakes/shared-kube.js'))
vi.mock('../../src/adapters/email.js', () => import('../fakes/email-capture.js'))

import { fakeKube } from '../fakes/shared-kube.js'
import { sentEmails } from '../fakes/email-capture.js'

const ISSUER = process.env.ISSUER_URL
const RP = {
    client_id: 'gallery',
    client_secret: 'gallery-secret',
    redirect_uri: 'https://gallery.test/auth/callback',
}
// The resource server the access token is meant for, and the scopes it defines.
// They are the application's own vocabulary, not Passmower's — the point of the
// test is that Passmower never had to learn them.
const RESOURCE = 'https://gallery.test/api'
const GRANTED_SCOPE = 'gallery:images:read'
const UNLISTED_SCOPE = 'gallery:images:delete'

const base64url = (buf) => buf.toString('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')

const decodeJwt = (jwt) => JSON.parse(
    Buffer.from(jwt.split('.')[1], 'base64url').toString())

describe('custom API scopes on resource-bound access tokens (HTTP)', () => {
    let callback

    beforeAll(async () => {
        process.env.REDIS_URI ??= 'redis://127.0.0.1:6379'
        process.env.EMAIL_ENABLED = 'true'
        globalThis.logger = { debug() {}, info() {}, warn() {}, error() {}, trace() {} }
        const { buildProvider } = await import('../../src/app.js')
        const provider = await buildProvider()
        callback = provider.callback()

        const { default: RedisAdapter } = await import('../../src/adapters/redis.js')
        await new RedisAdapter('Client').upsert(RP.client_id, {
            client_id: RP.client_id,
            client_secret: RP.client_secret,
            redirect_uris: [RP.redirect_uri],
            grant_types: ['authorization_code'],
            response_types: ['code'],
            token_endpoint_auth_method: 'client_secret_basic',
            // None of these beyond openid/email are scopes Passmower serves.
            availableScopes: ['openid', 'email', GRANTED_SCOPE, 'gallery:images:write'],
            allowedGroups: [],
            allowedCORSOrigins: [],
        })
    })

    afterAll(async () => {
        const { disconnect } = await import('../../src/adapters/redis.js')
        await disconnect()
    })

    beforeEach(() => {
        fakeKube.store.clear()
        sentEmails.length = 0
        fakeKube.seed('OIDCUser', {
            metadata: { name: 'testuser', labels: {} },
            spec: { email: 'test@example.com', name: 'Test User', groups: [] },
            passmower: { email: 'test@example.com' },
            status: {
                primaryEmail: 'test@example.com',
                emails: ['test@example.com'],
                groups: [],
                profile: { name: 'Test User' },
                conditions: [],
                termsOfService: {
                    acceptedAt: '2026-08-06T12:00:00.000Z',
                    contentHash: 'test-content-hash',
                },
            },
        })
    })

    // --- tiny cookie-jar HTTP driver ---------------------------------------
    const jar = () => new Map()
    const cookieHeader = (j) => [...j.entries()].map(([k, v]) => `${k}=${v}`).join('; ')
    function store(j, res) {
        for (const c of res.headers['set-cookie'] ?? []) {
            const pair = c.split(';')[0]
            const i = pair.indexOf('=')
            const name = pair.slice(0, i).trim()
            const val = pair.slice(i + 1)
            if (val === '') j.delete(name)
            else j.set(name, val)
        }
    }
    async function req(j, method, path, form) {
        let r = request(callback)[method](path).set('Cookie', cookieHeader(j))
        if (form) r = r.type('form').send(form)
        const res = await r
        store(j, res)
        return res
    }
    const rpHost = new URL(RP.redirect_uri).host
    async function follow(j, res, maxHops = 12) {
        let cur = res
        for (let i = 0; i < maxHops && cur.status >= 300 && cur.status < 400; i++) {
            const loc = cur.headers.location
            if (!loc) break
            const u = loc.startsWith('http') ? new URL(loc) : new URL(loc, ISSUER)
            if (u.host === rpHost) return cur
            cur = await req(j, 'get', u.pathname + u.search)
        }
        return cur
    }

    // Log in by magic link asking for `scope` (and optionally a resource), and
    // return the token response.
    async function login(scope, resource = RESOURCE) {
        const j = jar()
        const verifier = base64url(randomBytes(32))
        const challenge = base64url(createHash('sha256').update(verifier).digest())
        const authQuery = new URLSearchParams({
            client_id: RP.client_id,
            redirect_uri: RP.redirect_uri,
            response_type: 'code',
            scope,
            state: 'state-api-scopes',
            nonce: 'nonce-api-scopes',
            code_challenge: challenge,
            code_challenge_method: 'S256',
        })
        if (resource) {
            authQuery.set('resource', resource)
        }

        let res = await follow(j, await req(j, 'get', `/auth?${authQuery}`))
        const uid = (res.headers.location ?? res.request.url).match(/\/interaction\/([^/?]+)/)[1]
        await req(j, 'post', `/interaction/${uid}/email`, { email: 'test@example.com' })
        const linkPath = sentEmails[0].html.match(/\/interaction\/[^/]+\/verify-email\/[0-9a-f-]+/)[0]
        const final = await follow(j, await req(j, 'get', linkPath))
        const code = new URL(final.headers.location).searchParams.get('code')

        const tokenRes = await request(callback)
            .post('/token')
            .auth(RP.client_id, RP.client_secret)
            .type('form')
            .send({
                grant_type: 'authorization_code',
                code,
                redirect_uri: RP.redirect_uri,
                code_verifier: verifier,
            })
            .expect(200)

        return tokenRes.body
    }

    it('carries an API scope Passmower does not serve into the JWT access token', async () => {
        const token = await login(`openid email ${GRANTED_SCOPE}`)

        // Requesting a resource makes the access token a self-contained JWT
        // audience-bound to that resource, which the resource server validates
        // against the JWKS endpoint instead of calling introspection.
        const accessToken = decodeJwt(token.access_token)
        expect(accessToken.aud).toBe(RESOURCE)
        expect(accessToken.scope.split(' ')).toContain(GRANTED_SCOPE)
        expect(token.scope.split(' ')).toContain(GRANTED_SCOPE)

        // The login itself is untouched: the API scope rides alongside OIDC.
        expect(decodeJwt(token.id_token).sub).toBe('testuser')
    })

    it('drops an API scope the client does not list in availableScopes', async () => {
        const token = await login(`openid email ${GRANTED_SCOPE} ${UNLISTED_SCOPE}`)

        // availableScopes is what getResourceServerInfo hands the resource
        // server, so it is the allowlist for API scopes even though the CRD no
        // longer constrains the values.
        const accessToken = decodeJwt(token.access_token)
        expect(accessToken.scope.split(' ')).toContain(GRANTED_SCOPE)
        expect(accessToken.scope.split(' ')).not.toContain(UNLISTED_SCOPE)
    })

    it('ignores an API scope when no resource is requested', async () => {
        const token = await login(`openid email ${GRANTED_SCOPE}`, null)

        // No resource means an opaque reference token, and nothing to carry an
        // API scope — so it is silently not granted rather than an error.
        expect(token.access_token.split('.')).toHaveLength(1)
        expect((token.scope ?? '').split(' ')).not.toContain(GRANTED_SCOPE)
    })
})
