import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest'
import request from 'supertest'

vi.mock('../../src/adapters/kubernetes.js', () => import('../fakes/shared-kube.js'))
vi.mock('../../src/adapters/email.js', () => import('../fakes/email-capture.js'))

import { fakeKube } from '../fakes/shared-kube.js'
import { sentEmails } from '../fakes/email-capture.js'

// Offboarding (#73): disabling an account ends its live session on the next
// request and refuses a fresh sign-in, while the OIDCUser itself stays.
const ISSUER_HOSTNAME = new URL(process.env.ISSUER_URL).hostname

const user = (name, type, email, groups = []) => ({
    metadata: { name, labels: {} },
    spec: { type, email, name, groups },
    passmower: { email },
    status: {
        primaryEmail: email, emails: [email], groups,
        profile: { name: `${name} display`, company: 'Example OÜ' }, conditions: [],
        termsOfService: { acceptedAt: '2026-08-06T12:00:00.000Z', contentHash: 'hash' },
    },
})

describe('disabled accounts (HTTP)', () => {
    let callback
    const saved = {}

    beforeAll(async () => {
        process.env.REDIS_URI ??= 'redis://127.0.0.1:6379'
        process.env.EMAIL_ENABLED = 'true'
        globalThis.logger = { debug() {}, info() {}, warn() {}, error() {}, trace() {} }
        const { buildProvider } = await import('../../src/app.js')
        callback = (await buildProvider()).callback()
    })

    afterAll(async () => {
        for (const [k, v] of Object.entries(saved)) {
            if (v === undefined) delete process.env[k]
            else process.env[k] = v
        }
        const { disconnect } = await import('../../src/adapters/redis.js')
        await disconnect()
    })

    beforeEach(() => {
        fakeKube.store.clear()
        sentEmails.length = 0
        fakeKube.seed('OIDCUser', user('testuser', undefined, 'test@example.com'))
        fakeKube.seed('OIDCUser', user('colleague', 'person', 'colleague@example.com', [
            { prefix: 'local', name: 'admins' }, { prefix: 'local', name: 'unlisted' },
        ]))
        fakeKube.seed('OIDCUser', user('reserved', 'banned', 'reserved@example.com'))
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
    async function req(j, method, path, form) {
        let r = request(callback)[method](path).set('Cookie', cookieHeader(j))
        if (form) r = r.type('form').send(form)
        const res = await r
        store(j, res)
        return res
    }
    async function follow(j, res, maxHops = 16) {
        let cur = res
        for (let i = 0; i < maxHops && cur.status >= 300 && cur.status < 400; i++) {
            const u = new URL(cur.headers.location, process.env.ISSUER_URL)
            if (![ISSUER_HOSTNAME, '127.0.0.1'].includes(u.hostname)) return cur
            cur = await req(j, 'get', u.pathname + u.search)
        }
        return cur
    }
    // Opens a dashboard page, signing in with the magic link on the way.
    async function openSignedOut(j, path) {
        const res = await follow(j, await req(j, 'get', path))
        const uid = (res.headers.location ?? res.request.url).match(/\/interaction\/([^/?]+)/)[1]
        await req(j, 'post', `/interaction/${uid}/email`, { email: 'test@example.com' })
        const link = sentEmails.at(-1).html.match(/\/interaction\/[^/]+\/verify-email\/[0-9a-f-]+/)[0]
        return follow(j, await req(j, 'get', link))
    }

    const setUser = (mutate) => {
        const key = [...fakeKube.store.keys()].find(k => k.endsWith('/testuser'))
        const stored = structuredClone(fakeKube.store.get(key))
        mutate(stored)
        fakeKube.store.set(key, stored)
    }

    it.each([
        ['the OIDCUser spec', (u) => { u.spec.disabled = true }],
        ['the admin panel section', (u) => { u.passmower = { ...u.passmower, disabled: true } }],
    ])('ends the live session when the account is disabled in %s', async (_, disable) => {
        const j = new Map()
        await openSignedOut(j, '/')
        expect((await req(j, 'get', '/api/me')).status).toBe(200)

        setUser(disable)

        const res = await req(j, 'get', '/api/me')
        expect(res.status).toBe(404)
        expect(res.body).toEqual({})
        // The account itself is kept.
        expect([...fakeKube.store.keys()].some(k => k.endsWith('/testuser'))).toBe(true)
    })

    it('refuses a fresh sign-in and admits it again once enabled', async () => {
        setUser((u) => { u.spec.disabled = true })
        const refused = new Map()
        // The magic link is accepted, the login is not: no session comes of it.
        await openSignedOut(refused, '/')
        expect((await req(refused, 'get', '/api/me')).status).toBe(404)

        setUser((u) => { u.spec.disabled = false })
        const j = new Map()
        await openSignedOut(j, '/')
        expect((await req(j, 'get', '/api/me')).status).toBe(200)
    })
})
