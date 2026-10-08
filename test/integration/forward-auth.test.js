import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest'
import request from 'supertest'

vi.mock('../../src/adapters/kubernetes.js', () => import('../fakes/shared-kube.js'))
vi.mock('../../src/adapters/email.js', () => import('../fakes/email-capture.js'))

import { fakeKube } from '../fakes/shared-kube.js'
import { sentEmails } from '../fakes/email-capture.js'

// Forward-auth sign-in end to end: tokens are only ever delivered to
// Passmower's own return endpoint, the page the user asked for travels in a
// signed state, and request headers never add redirect URIs to a client.
// ISSUER_URL is https://oidc.test.example.com/, so the base domain is
// example.com.
const CLIENT = 'middleware-apps.webmail'
const APP_PAGE = 'https://webmail.example.com/inbox?folder=1'
const ISSUER_HOSTNAME = new URL(process.env.ISSUER_URL).hostname

const forwardAuthHeaders = (overrides = {}) => ({
    'x-forwarded-proto': 'https',
    'x-forwarded-host': 'webmail.example.com',
    'x-forwarded-uri': '/inbox?folder=1',
    ...overrides,
})

describe('forward-auth sign-in (HTTP)', () => {
    let callback
    let clients
    let returnUri

    beforeAll(async () => {
        process.env.REDIS_URI ??= 'redis://127.0.0.1:6379'
        process.env.EMAIL_ENABLED = 'true'
        globalThis.logger = { debug() {}, info() {}, warn() {}, error() {}, trace() {} }
        const { buildProvider } = await import('../../src/app.js')
        callback = (await buildProvider()).callback()

        const { default: RedisAdapter } = await import('../../src/adapters/redis.js')
        const { forwardAuthRedirectUri } = await import('../../src/utils/session/forward-auth-return.js')
        returnUri = forwardAuthRedirectUri()
        clients = new RedisAdapter('Client')
        await clients.upsert('regular', {
            client_id: 'regular',
            client_secret: 'secret',
            redirect_uris: ['https://rp.example.com/callback'],
            grant_types: ['authorization_code'],
            response_types: ['code'],
            availableScopes: ['openid'],
            allowedGroups: [],
        })
    })

    afterAll(async () => {
        const { disconnect } = await import('../../src/adapters/redis.js')
        await disconnect()
    })

    beforeEach(async () => {
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
        const { default: OIDCMiddlewareClient } = await import('../../src/models/oidc-middleware-client.js')
        const middlewareClient = new OIDCMiddlewareClient().fromIncomingClient({
            metadata: { name: 'webmail', namespace: 'apps', uid: 'uid-webmail' },
            spec: { uri: 'https://webmail.example.com/', headerMapping: { user: 'Remote-User' } },
        })
        expect(middlewareClient.getClientId()).toBe(CLIENT)
        await clients.upsert(CLIENT, middlewareClient.toRedis())
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
    async function req(j, method, path, {form, headers = {}} = {}) {
        let r = request(callback)[method](path).set('Cookie', cookieHeader(j)).set(headers)
        if (form) r = r.type('form').send(form)
        const res = await r
        store(j, res)
        return res
    }
    // Follow redirects while they stay on Passmower (the issuer, or supertest's
    // own address for URLs oidc-provider builds from the request); stop at the
    // first one that leaves it.
    async function follow(j, res, maxHops = 14) {
        let cur = res
        for (let i = 0; i < maxHops && cur.status >= 300 && cur.status < 400; i++) {
            const u = new URL(cur.headers.location, process.env.ISSUER_URL)
            if (![ISSUER_HOSTNAME, '127.0.0.1'].includes(u.hostname)) return cur
            cur = await req(j, 'get', u.pathname + u.search)
        }
        return cur
    }
    const forwardAuth = (j, headers = forwardAuthHeaders(), client = CLIENT) =>
        req(j, 'get', `/forward-auth?client=${encodeURIComponent(client)}`, {headers})

    // Submit oidc-provider's auto-submitting form_post page the way a browser
    // would, from a bare jar: the return endpoint needs no cookies.
    function formInputs(res) {
        return Object.fromEntries([...res.text.matchAll(/name="([^"]+)" value="([^"]*)"/g)].map(m => [m[1], m[2]]))
    }
    async function signIn(j) {
        const start = await forwardAuth(j)
        expect(start.status).toBe(302)
        let res = await follow(j, start)
        const uid = (res.headers.location ?? res.request.url).match(/\/interaction\/([^/?]+)/)[1]
        await req(j, 'post', `/interaction/${uid}/email`, {form: { email: 'test@example.com' }})
        const link = sentEmails.at(-1).html.match(/\/interaction\/[^/]+\/verify-email\/[0-9a-f-]+/)[0]
        const posted = await follow(j, await req(j, 'get', link))
        expect(posted.status).toBe(200)
        expect(posted.text).toContain(`action="${returnUri}"`)
        return req(jar(), 'post', '/forward-auth/return', {form: formInputs(posted)})
    }

    it('starts authorization against the fixed return endpoint with a signed state', async () => {
        const res = await forwardAuth(jar())
        expect(res.status).toBe(302)
        const auth = new URL(res.headers.location)
        expect(auth.searchParams.get('client_id')).toBe(CLIENT)
        expect(auth.searchParams.get('redirect_uri')).toBe(returnUri)
        expect(auth.searchParams.get('response_mode')).toBe('form_post')
        expect(auth.searchParams.get('state')).toMatch(/^[\w-]+\.[\w-]+$/)
        expect((await clients.find(CLIENT)).redirect_uris).toEqual([returnUri])
    })

    it('returns to the requested page after sign-in without sending it a token', async () => {
        const j = jar()
        const done = await signIn(j)
        expect(done.status).toBe(303)
        expect(done.headers.location).toBe(APP_PAGE)

        const authed = await forwardAuth(j)
        expect(authed.status).toBe(200)
        expect(authed.headers['remote-user']).toBe('testuser')
    })

    it('delivers repeat authorization responses to Passmower, then redirects to the page', async () => {
        const j = jar()
        await signIn(j)

        const start = await forwardAuth(jar())
        const res = await req(j, 'get', new URL(start.headers.location).pathname + new URL(start.headers.location).search)
        expect(res.status).toBe(200)
        expect(res.text).toContain(`action="${returnUri}"`)
        expect(res.text).not.toContain('webmail.example.com')

        const form = formInputs(res)
        expect(form.id_token).toBeDefined()
        const back = await req(jar(), 'post', '/forward-auth/return', {form})
        expect(back.status).toBe(303)
        expect(back.headers.location).toBe(APP_PAGE)
    })

    it('refuses look-alike and spoofed hosts and keeps the client untouched', async () => {
        const lookAlike = await forwardAuth(jar(), forwardAuthHeaders({'x-forwarded-host': 'evilwebmail.example.org'}))
        expect(lookAlike.status).toBe(401)
        const suffix = await forwardAuth(jar(), forwardAuthHeaders({'x-forwarded-host': 'evilexample.com'}))
        expect(suffix.status).toBe(401)

        const forwarded = await forwardAuth(jar(), forwardAuthHeaders({forwarded: 'host=evilexample.com;proto=https'}))
        const state = new URL(forwarded.headers.location).searchParams.get('state')
        const back = await req(jar(), 'post', '/forward-auth/return', {form: {state}})
        expect(back.headers.location).toBe(APP_PAGE)

        expect((await clients.find(CLIENT)).redirect_uris).toEqual([returnUri])
    })

    it('registers only the return endpoint and refuses any other redirect URI', async () => {
        expect((await clients.find(CLIENT)).redirect_uris).toEqual([returnUri])
        for (const redirect_uri of ['https://evilexample.com/steal', 'https://webmail.example.com/']) {
            const res = await request(callback).get('/auth?' + new URLSearchParams({
                client_id: CLIENT, response_type: 'id_token', scope: 'openid', nonce: 'n', redirect_uri,
            }))
            expect(res.status).toBe(400)
            expect(res.text).toMatch(/redirect_uri/)
        }
    })

    it('serves only forward-auth clients', async () => {
        const res = await forwardAuth(jar(), forwardAuthHeaders(), 'regular')
        expect(res.status).toBe(401)
        expect(res.text).toBe('unknown client')
        expect((await clients.find('regular')).redirect_uris).toEqual(['https://rp.example.com/callback'])
    })

    it('sends a failed sign-in back to the page, and rejects forged or missing state', async () => {
        const start = await forwardAuth(jar())
        const state = new URL(start.headers.location).searchParams.get('state')
        const denied = await req(jar(), 'post', '/forward-auth/return', {form: {state, error: 'access_denied'}})
        expect(denied.status).toBe(303)
        expect(denied.headers.location).toBe(APP_PAGE)

        const missing = await req(jar(), 'post', '/forward-auth/return', {form: {}})
        expect(missing.status).toBe(400)
        const forged = await req(jar(), 'post', '/forward-auth/return', {form: {state: 'eyJ1IjoiaHR0cHM6Ly9ldmlsLmNvbS8ifQ.x'}})
        expect(forged.status).toBe(400)
        const failed = await req(jar(), 'post', '/forward-auth/return', {form: {error: 'access_denied', error_description: 'Call +1-555'}})
        expect(failed.status).toBe(403)
        expect(failed.text).toBe('Sign-in was not completed: access_denied')
    })

    it('starts dashboard sign-in with the self client', async () => {
        const res = await request(callback).get('/')
        const href = res.status === 302 ? res.headers.location : res.text.match(/href="([^"]*\/auth\?[^"]*)"/)?.[1]?.replace(/&amp;/g, '&')
        const auth = new URL(href, process.env.ISSUER_URL)
        expect(auth.pathname).toBe('/auth')
        expect(Object.fromEntries(auth.searchParams)).toEqual({
            client_id: 'passmower', response_type: 'id_token', scope: 'openid',
            redirect_uri: process.env.ISSUER_URL, nonce: expect.any(String),
        })
    })
})
