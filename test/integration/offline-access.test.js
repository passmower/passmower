import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest'
import request from 'supertest'
import { createHash, randomBytes } from 'node:crypto'

vi.mock('../../src/adapters/kubernetes.js', () => import('../fakes/shared-kube.js'))
vi.mock('../../src/adapters/email.js', () => import('../fakes/email-capture.js'))

import { fakeKube } from '../fakes/shared-kube.js'
import { sentEmails } from '../fakes/email-capture.js'

// What oidc-provider does to offline_access, pinned as behaviour rather than
// left as a question in a TODO. Its authorization `scopes.js` drops the scope
// unless the response type returns a code, the client is allowed the
// refresh_token grant, and the request carries prompt=consent (OIDC Core §11).
//
// Passmower's own rule sits on top: a refresh token goes to any client allowed
// the refresh_token grant, whether or not the scope survived (#243). Pinning
// both here means an oidc-provider upgrade that changes the scope rules fails
// loudly rather than quietly reshaping refresh behaviour.
const REDIRECT = 'https://rp.test/callback'
const SECRET = 'rp-secret'

const client = (clientId, {grantTypes, availableScopes}) => ({
    client_id: clientId,
    client_secret: SECRET,
    redirect_uris: [REDIRECT],
    grant_types: grantTypes,
    response_types: ['code'],
    token_endpoint_auth_method: 'client_secret_basic',
    availableScopes,
    allowedGroups: [],
    allowedCORSOrigins: [],
})

const base64url = (buf) => buf.toString('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')

describe('offline_access and refresh tokens (HTTP)', () => {
    let callback

    beforeAll(async () => {
        process.env.REDIS_URI ??= 'redis://127.0.0.1:6379'
        process.env.EMAIL_ENABLED = 'true'
        globalThis.logger = { debug() {}, info() {}, warn() {}, error() {}, trace() {} }
        const { buildProvider } = await import('../../src/app.js')
        callback = (await buildProvider()).callback()

        const { default: RedisAdapter } = await import('../../src/adapters/redis.js')
        const clients = new RedisAdapter('Client')
        await clients.upsert('refreshable', client('refreshable', {
            grantTypes: ['authorization_code', 'refresh_token'],
            availableScopes: ['openid', 'offline_access'],
        }))
        await clients.upsert('no-available-scope', client('no-available-scope', {
            grantTypes: ['authorization_code', 'refresh_token'],
            availableScopes: ['openid'],
        }))
        await clients.upsert('no-refresh-grant', client('no-refresh-grant', {
            grantTypes: ['authorization_code'],
            availableScopes: ['openid', 'offline_access'],
        }))
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
                primaryEmail: 'test@example.com', emails: ['test@example.com'], groups: [],
                profile: { name: 'Test User' }, conditions: [],
                termsOfService: { acceptedAt: '2026-08-06T12:00:00.000Z', contentHash: 'hash' },
            },
        })
    })

    const jar = () => new Map()
    const cookieHeader = (j) => [...j.entries()].map(([k, v]) => `${k}=${v}`).join('; ')
    function store(j, res) {
        for (const c of res.headers['set-cookie'] ?? []) {
            const pair = c.split(';')[0]
            const i = pair.indexOf('=')
            const val = pair.slice(i + 1)
            if (val === '') j.delete(pair.slice(0, i).trim())
            else j.set(pair.slice(0, i).trim(), val)
        }
    }
    async function req(j, method, path, form) {
        let r = request(callback)[method](path).set('Cookie', cookieHeader(j))
        if (form) r = r.type('form').send(form)
        const res = await r
        store(j, res)
        return res
    }
    async function follow(j, res, maxHops = 14) {
        let cur = res
        for (let i = 0; i < maxHops && cur.status >= 300 && cur.status < 400; i++) {
            const loc = cur.headers.location
            if (!loc) break
            const u = loc.startsWith('http') ? new URL(loc) : new URL(loc, process.env.ISSUER_URL)
            if (u.host === new URL(REDIRECT).host) return cur
            cur = await req(j, 'get', u.pathname + u.search)
        }
        return cur
    }

    // Sign in with the magic link and exchange the code, returning what the
    // token endpoint granted.
    async function authorize(clientId, extraParams = {}) {
        // Own mailbox per call: a test that authorizes twice must not pick up
        // the first flow's (already used) magic link.
        sentEmails.length = 0
        const j = jar()
        const verifier = base64url(randomBytes(32))
        const query = new URLSearchParams({
            client_id: clientId,
            redirect_uri: REDIRECT,
            response_type: 'code',
            scope: 'openid offline_access',
            state: 'state-243',
            code_challenge: base64url(createHash('sha256').update(verifier).digest()),
            code_challenge_method: 'S256',
            ...extraParams,
        })

        let res = await follow(j, await req(j, 'get', `/auth?${query}`))
        const uid = (res.headers.location ?? res.request.url).match(/\/interaction\/([^/?]+)/)[1]
        await req(j, 'post', `/interaction/${uid}/email`, { email: 'test@example.com' })
        const link = sentEmails.at(-1).html.match(/\/interaction\/[^/]+\/verify-email\/[0-9a-f-]+/)[0]
        const final = await follow(j, await req(j, 'get', link))
        const code = new URL(final.headers.location).searchParams.get('code')

        const tokens = await request(callback)
            .post('/token')
            .auth(clientId, SECRET)
            .type('form')
            .send({
                grant_type: 'authorization_code', code,
                redirect_uri: REDIRECT, code_verifier: verifier,
            })
            .expect(200)

        return {
            scopes: (tokens.body.scope ?? '').split(' ').filter(Boolean),
            refreshToken: tokens.body.refresh_token,
        }
    }

    it('drops offline_access from a request without prompt=consent', async () => {
        const granted = await authorize('refreshable')

        // Asking for the scope is not enough — this is the condition that
        // catches people, and it holds even for a client that lists
        // offline_access in availableScopes.
        expect(granted.scopes).not.toContain('offline_access')
        expect(granted.scopes).toContain('openid')
    })

    it('keeps offline_access when the request carries prompt=consent', async () => {
        const granted = await authorize('refreshable', { prompt: 'consent' })

        expect(granted.scopes).toContain('offline_access')
    })

    it('does not depend on availableScopes listing offline_access', async () => {
        // availableScopes populates the generated Secret and lets the grant
        // carry the scope; it does not gate what the request may ask for, so
        // pairing grantTypes with availableScopes is not what decides this.
        const granted = await authorize('no-available-scope', { prompt: 'consent' })

        expect(granted.scopes).toContain('offline_access')
    })

    it('drops offline_access for a client not allowed the refresh_token grant', async () => {
        const granted = await authorize('no-refresh-grant', { prompt: 'consent' })

        expect(granted.scopes).not.toContain('offline_access')
    })

    it('issues a refresh token to a client allowed the grant, with or without the scope', async () => {
        // Renewal within the session does not need the offline_access ceremony;
        // see configuration.js issueRefreshToken.
        expect((await authorize('refreshable')).refreshToken).toBeTruthy()
        expect((await authorize('refreshable', { prompt: 'consent' })).refreshToken).toBeTruthy()
    })

    it('withholds one from a client not allowed the grant', async () => {
        // It used to be handed one the token endpoint then refused with
        // "requested grant type is not allowed for this client".
        expect((await authorize('no-refresh-grant', { prompt: 'consent' })).refreshToken)
            .toBeUndefined()
    })
})
