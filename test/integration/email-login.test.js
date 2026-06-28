import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest'
import request from 'supertest'
import { createHash, randomBytes } from 'node:crypto'

// Replace the Kubernetes adapter and email adapter before the app is imported.
vi.mock('../../src/adapters/kubernetes.js', () => import('../fakes/shared-kube.js'))
vi.mock('../../src/adapters/email.js', () => import('../fakes/email-capture.js'))

import { fakeKube } from '../fakes/shared-kube.js'
import { sentEmails } from '../fakes/email-capture.js'

const ISSUER = process.env.ISSUER_URL // e.g. https://oidc.test.example.com/
const RP = {
    client_id: 'test-rp',
    client_secret: 'test-rp-secret',
    redirect_uri: 'https://rp.test/callback',
}

function base64url(buf) {
    return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

describe('email magic-link login (HTTP)', () => {
    let callback

    beforeAll(async () => {
        process.env.REDIS_URI ??= 'redis://127.0.0.1:6379'
        process.env.EMAIL_ENABLED = 'true'  // route is gated on this
        globalThis.logger = { debug() {}, info() {}, warn() {}, error() {}, trace() {} }
        const { buildProvider } = await import('../../src/app.js')
        const provider = await buildProvider()
        callback = provider.callback()

        // Register a downstream relying-party client directly in Redis (the
        // oidc-provider adapter), mirroring what the kube client operator would do.
        const { default: RedisAdapter } = await import('../../src/adapters/redis.js')
        await new RedisAdapter('Client').upsert(RP.client_id, {
            client_id: RP.client_id,
            client_secret: RP.client_secret,
            redirect_uris: [RP.redirect_uri],
            grant_types: ['authorization_code'],
            response_types: ['code'],
            token_endpoint_auth_method: 'client_secret_basic',
            // extraClientMetadata fields real clients always carry (addGrant reads availableScopes)
            availableScopes: ['openid'],
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
        // Seed an existing, fully-onboarded user so the post-login policy only
        // has to clear the (auto-resolved) consent prompt.
        fakeKube.seed('OIDCUser', {
            metadata: { name: 'testuser', labels: {} },
            spec: { email: 'test@example.com', name: 'Test User' },
            passmower: { email: 'test@example.com' },
            status: {
                primaryEmail: 'test@example.com',
                emails: ['test@example.com'],
                groups: [],
                profile: { name: 'Test User' },
                conditions: [{ type: 'ToSv1', status: 'True' }],
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
        if (process.env.DEBUG_FLOW) {
            console.error(`[hop] ${method.toUpperCase()} ${path.slice(0, 60)} -> ${res.status} loc=${res.headers.location ?? '-'} jar=[${[...j.keys()].join(',')}]`)
        }
        return res
    }
    // Follow redirects by path until we hit the relying party's callback host.
    // (oidc-provider builds resume URLs from the request Host, which under
    // supertest is an ephemeral 127.0.0.1:port — so we can't key off the issuer
    // host; we stop specifically at the RP redirect_uri host.)
    const rpHost = new URL(RP.redirect_uri).host
    async function follow(j, res, maxHops = 12) {
        let cur = res
        for (let i = 0; i < maxHops && cur.status >= 300 && cur.status < 400; i++) {
            const loc = cur.headers.location
            if (!loc) break
            const u = loc.startsWith('http') ? new URL(loc) : new URL(loc, ISSUER)
            if (u.host === rpHost) return cur // RP callback reached
            cur = await req(j, 'get', u.pathname + u.search)
        }
        return cur
    }

    it('logs in via the magic link, creates a grant and returns an auth code', async () => {
        const j = jar()
        const verifier = base64url(randomBytes(32))
        const challenge = base64url(createHash('sha256').update(verifier).digest())
        const authQuery = new URLSearchParams({
            client_id: RP.client_id,
            redirect_uri: RP.redirect_uri,
            response_type: 'code',
            scope: 'openid',
            state: 'state-123',
            nonce: 'nonce-123',
            code_challenge: challenge,
            code_challenge_method: 'S256',
        })

        // 1. Authorization request -> interaction
        let res = await req(j, 'get', `/auth?${authQuery}`)
        res = await follow(j, res)
        expect(res.headers.location ?? res.request.url).toMatch(/\/interaction\//)
        const uid = (res.headers.location ?? res.request.url).match(/\/interaction\/([^/?]+)/)[1]

        // 2. Submit the email -> magic link is "sent"
        res = await req(j, 'post', `/interaction/${uid}/email`, { email: 'test@example.com' })
        expect(sentEmails).toHaveLength(1)
        const linkPath = sentEmails[0].html.match(/\/interaction\/[^/]+\/verify-email\/[0-9a-f-]+/)[0]

        // 3. Click the magic link -> login completes, consent auto-resolves, code issued
        res = await req(j, 'get', linkPath)
        const final = await follow(j, res)

        const loc = final.headers.location ?? ''
        expect(loc).toContain(RP.redirect_uri)
        const code = new URL(loc).searchParams.get('code')
        expect(code).toBeTruthy()
        expect(new URL(loc).searchParams.get('state')).toBe('state-123')

        // 4. Exchange the code for tokens
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

        expect(tokenRes.body.access_token).toBeTruthy()
        const idClaims = JSON.parse(Buffer.from(tokenRes.body.id_token.split('.')[1], 'base64url').toString())
        expect(idClaims.sub).toBe('testuser')
        expect(idClaims.nonce).toBe('nonce-123')
    })
})
