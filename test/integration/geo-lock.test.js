import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest'
import request from 'supertest'
import { createHash, randomBytes } from 'node:crypto'
import { fileURLToPath } from 'node:url'

vi.mock('../../src/adapters/kubernetes.js', () => import('../fakes/shared-kube.js'))
vi.mock('../../src/adapters/email.js', () => import('../fakes/email-capture.js'))

import { fakeKube } from '../fakes/shared-kube.js'
import { sentEmails } from '../fakes/email-capture.js'

// Geo-lock end to end (#315): the session is pinned to the country it signed
// in from; the same cookie presented from another country ends it, and a
// public client's refresh from abroad is refused. Countries come from MaxMind's
// GeoIP2-Country test database.
const GB = '81.2.69.142'
const SE = '89.160.20.112'
const REDIRECT = 'https://rp.test/callback'
const SECRET = 'rp-secret'

const base64url = (buf) => buf.toString('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')

const client = (clientId, tokenEndpointAuthMethod) => ({
    client_id: clientId,
    ...(tokenEndpointAuthMethod === 'none' ? {} : {client_secret: SECRET}),
    redirect_uris: [REDIRECT],
    grant_types: ['authorization_code', 'refresh_token'],
    response_types: ['code'],
    token_endpoint_auth_method: tokenEndpointAuthMethod,
    availableScopes: ['openid'],
    allowedGroups: [],
    allowedCORSOrigins: [],
})

describe('geo-lock (HTTP)', () => {
    let callback
    const saved = {}

    beforeAll(async () => {
        for (const k of ['GEO_LOCK_ENABLED', 'GEOIP_DATABASE_PATH', 'GEO_LOCK_ALLOWED_COUNTRIES', 'INCIDENTS_ENABLED']) saved[k] = process.env[k]
        process.env.GEO_LOCK_ENABLED = 'true'
        process.env.GEOIP_DATABASE_PATH = fileURLToPath(new URL('../fixtures/geoip/GeoIP2-Country-Test.mmdb', import.meta.url))
        process.env.INCIDENTS_ENABLED = 'false'
        process.env.REDIS_URI ??= 'redis://127.0.0.1:6379'
        process.env.EMAIL_ENABLED = 'true'
        globalThis.logger = { debug() {}, info() {}, warn() {}, error() {}, trace() {} }
        const { resetGeoipReader } = await import('../../src/utils/geoip.js')
        resetGeoipReader()
        const { buildProvider } = await import('../../src/app.js')
        callback = (await buildProvider()).callback()

        const { default: RedisAdapter } = await import('../../src/adapters/redis.js')
        const clients = new RedisAdapter('Client')
        await clients.upsert('geo-public', client('geo-public', 'none'))
        await clients.upsert('geo-confidential', client('geo-confidential', 'client_secret_basic'))
    })

    afterAll(async () => {
        for (const [k, v] of Object.entries(saved)) {
            if (v === undefined) delete process.env[k]
            else process.env[k] = v
        }
        const { resetGeoipReader } = await import('../../src/utils/geoip.js')
        resetGeoipReader()
        const { disconnect } = await import('../../src/adapters/redis.js')
        await disconnect()
    })

    beforeEach(() => {
        delete process.env.GEO_LOCK_ALLOWED_COUNTRIES
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
    // A browser: a cookie jar and the address it is seen from.
    const browser = (ip) => ({ jar: new Map(), ip })
    async function req(b, method, path, form) {
        let r = request(callback)[method](path).set('Cookie', cookieHeader(b.jar)).set('X-Forwarded-For', b.ip)
        if (form) r = r.type('form').send(form)
        const res = await r
        store(b.jar, res)
        return res
    }
    async function follow(b, res, maxHops = 14) {
        let cur = res
        for (let i = 0; i < maxHops && cur.status >= 300 && cur.status < 400; i++) {
            const loc = cur.headers.location
            if (!loc) break
            const u = loc.startsWith('http') ? new URL(loc) : new URL(loc, process.env.ISSUER_URL)
            if (u.host === new URL(REDIRECT).host) return cur
            cur = await req(b, 'get', u.pathname + u.search)
        }
        return cur
    }

    function authorizeQuery(clientId) {
        const verifier = base64url(randomBytes(32))
        const query = new URLSearchParams({
            client_id: clientId,
            redirect_uri: REDIRECT,
            response_type: 'code',
            scope: 'openid',
            state: 'state-315',
            code_challenge: base64url(createHash('sha256').update(verifier).digest()),
            code_challenge_method: 'S256',
        })
        return { verifier, path: `/auth?${query}` }
    }

    // Starts an authorization; returns the code when the session answered it
    // silently (SSO), or the interaction uid when it asked for a login.
    async function startAuth(b, clientId) {
        const { verifier, path } = authorizeQuery(clientId)
        const res = await follow(b, await req(b, 'get', path))
        const loc = res.headers.location ?? ''
        if (loc.startsWith(REDIRECT)) return { code: new URL(loc).searchParams.get('code'), verifier }
        return { uid: (loc || res.request.url).match(/\/interaction\/([^/?]+)/)[1], verifier }
    }

    async function signIn(b, clientId) {
        sentEmails.length = 0
        const { uid, verifier } = await startAuth(b, clientId)
        expect(uid).toBeTruthy()
        await req(b, 'post', `/interaction/${uid}/email`, { email: 'test@example.com' })
        const link = sentEmails.at(-1).html.match(/\/interaction\/[^/]+\/verify-email\/[0-9a-f-]+/)[0]
        const final = await follow(b, await req(b, 'get', link))
        return { code: new URL(final.headers.location).searchParams.get('code'), verifier }
    }

    async function exchange(b, clientId, { code, verifier }) {
        let r = request(callback).post('/token').set('X-Forwarded-For', b.ip).type('form')
        const form = { grant_type: 'authorization_code', code, redirect_uri: REDIRECT, code_verifier: verifier }
        if (clientId === 'geo-public') form.client_id = clientId
        else r = r.auth(clientId, SECRET)
        const res = await r.send(form)
        expect(res.status).toBe(200)
        return res.body
    }

    function refresh(ip, clientId, refreshToken) {
        let r = request(callback).post('/token').set('X-Forwarded-For', ip).type('form')
        const form = { grant_type: 'refresh_token', refresh_token: refreshToken }
        if (clientId === 'geo-public') form.client_id = clientId
        else r = r.auth(clientId, SECRET)
        return r.send(form)
    }

    it('keeps single sign-on within the session country', async () => {
        const b = browser(GB)
        await signIn(b, 'geo-public')

        const again = await startAuth(b, 'geo-public')
        expect(again.code).toBeTruthy()
    })

    it('ends the session when its cookie is presented from another country', async () => {
        const b = browser(GB)
        await signIn(b, 'geo-public')

        const stolen = { jar: new Map(b.jar), ip: SE }
        const abroad = await startAuth(stolen, 'geo-public')
        expect(abroad.code).toBeUndefined()
        expect(abroad.uid).toBeTruthy()

        // The session is gone for its owner too: one fresh login re-pins it.
        const home = await startAuth(b, 'geo-public')
        expect(home.code).toBeUndefined()
    })

    it('re-pins the session to the country of a fresh login', async () => {
        await signIn(browser(GB), 'geo-public')
        const traveller = browser(SE)
        await signIn(traveller, 'geo-public')

        expect((await startAuth(traveller, 'geo-public')).code).toBeTruthy()
    })

    it('accepts an allowlisted country', async () => {
        const b = browser(GB)
        await signIn(b, 'geo-public')
        process.env.GEO_LOCK_ALLOWED_COUNTRIES = 'SE'

        expect((await startAuth({ jar: b.jar, ip: SE }, 'geo-public')).code).toBeTruthy()
    })

    it('refuses a public client refresh from another country', async () => {
        const b = browser(GB)
        const tokens = await exchange(b, 'geo-public', await signIn(b, 'geo-public'))
        expect(tokens.refresh_token).toBeTruthy()

        const abroad = await refresh(SE, 'geo-public', tokens.refresh_token)
        expect(abroad.status).toBe(400)
        expect(abroad.body.error).toBe('invalid_grant')

        const home = await refresh(GB, 'geo-public', tokens.refresh_token)
        expect(home.status).toBe(200)
    })

    it('leaves a confidential client refresh to the session check', async () => {
        const b = browser(GB)
        const tokens = await exchange(b, 'geo-confidential', await signIn(b, 'geo-confidential'))

        const backend = await refresh(SE, 'geo-confidential', tokens.refresh_token)
        expect(backend.status).toBe(200)
    })
})
