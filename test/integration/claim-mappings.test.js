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
    client_id: 'immich',
    client_secret: 'immich-secret',
    redirect_uri: 'https://immich.test/auth/callback',
}
// The shape from the issue (#220): an app with its own two-role model, driven
// from group membership.
const CLAIM_MAPPINGS = {
    immich_role: {
        default: 'user',
        rules: [{value: 'admin', groups: ['local:platform-admins']}],
    },
}

const base64url = (buf) => buf.toString('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')

describe('per-client claim mappings (HTTP)', () => {
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
            availableScopes: ['openid', 'email'],
            allowedGroups: [],
            allowedCORSOrigins: [],
            claimMappings: CLAIM_MAPPINGS,
        })
    })

    afterAll(async () => {
        const { disconnect } = await import('../../src/adapters/redis.js')
        await disconnect()
    })

    const seedUser = (groups) => {
        fakeKube.store.clear()
        sentEmails.length = 0
        fakeKube.seed('OIDCUser', {
            metadata: { name: 'testuser', labels: {} },
            spec: { email: 'test@example.com', name: 'Test User', groups },
            passmower: { email: 'test@example.com' },
            status: {
                primaryEmail: 'test@example.com',
                emails: ['test@example.com'],
                groups,
                profile: { name: 'Test User' },
                conditions: [],
                termsOfService: {
                    acceptedAt: '2026-08-06T12:00:00.000Z',
                    contentHash: 'test-content-hash',
                },
            },
        })
    }

    beforeEach(() => seedUser([{prefix: 'local', name: 'staff'}]))

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

    // Log in by magic link and return the token response plus userinfo.
    async function login() {
        const j = jar()
        const verifier = base64url(randomBytes(32))
        const challenge = base64url(createHash('sha256').update(verifier).digest())
        const authQuery = new URLSearchParams({
            client_id: RP.client_id,
            redirect_uri: RP.redirect_uri,
            response_type: 'code',
            scope: 'openid email',
            state: 'state-220',
            nonce: 'nonce-220',
            code_challenge: challenge,
            code_challenge_method: 'S256',
        })

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

        const idClaims = JSON.parse(
            Buffer.from(tokenRes.body.id_token.split('.')[1], 'base64url').toString())
        const userinfo = await request(callback)
            .get('/me')
            .set('Authorization', `Bearer ${tokenRes.body.access_token}`)
            .expect(200)

        return { idClaims, userinfo: userinfo.body }
    }

    it('emits the default value for a user in none of the mapped groups', async () => {
        const { idClaims, userinfo } = await login()

        expect(idClaims.immich_role).toBe('user')
        expect(userinfo.immich_role).toBe('user')
        // The mapping is additive: nothing it does displaces the real claims.
        expect(idClaims.sub).toBe('testuser')
        expect(idClaims.email).toBe('test@example.com')
    })

    it('emits the matching rule value for a member of a mapped group', async () => {
        seedUser([
            {prefix: 'local', name: 'staff'},
            {prefix: 'local', name: 'platform-admins'},
        ])

        const { idClaims, userinfo } = await login()

        expect(idClaims.immich_role).toBe('admin')
        expect(userinfo.immich_role).toBe('admin')
    })

    it('advertises a mapped claim in discovery once it has been registered', async () => {
        await login()

        const discovery = await request(callback)
            .get('/.well-known/openid-configuration')
            .expect(200)

        expect(discovery.body.claims_supported).toContain('immich_role')
    })
})
