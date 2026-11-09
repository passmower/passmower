import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest'
import request from 'supertest'

vi.mock('../../src/adapters/kubernetes.js', () => import('../fakes/shared-kube.js'))
vi.mock('../../src/adapters/email.js', () => import('../fakes/email-capture.js'))

import { fakeKube } from '../fakes/shared-kube.js'
import { sentEmails } from '../fakes/email-capture.js'

// User profile pages (#318): /users/<username> for signed-in users, the API
// behind it, and the shared link surviving the sign-in it triggers.
const ISSUER_HOSTNAME = new URL(process.env.ISSUER_URL).hostname

const user = (name, type, email, groups = []) => ({
    metadata: { name, labels: {} },
    spec: { type, email, name, groups: [] },
    passmower: { email },
    status: {
        primaryEmail: email, emails: [email], groups,
        profile: { name: `${name} display`, company: 'Example OÜ' }, conditions: [],
        termsOfService: { acceptedAt: '2026-08-06T12:00:00.000Z', contentHash: 'hash' },
    },
})

describe('user profile pages (HTTP)', () => {
    let callback
    const saved = {}

    beforeAll(async () => {
        for (const k of ['USER_PROFILES_ENABLED', 'PRIVILEGE_DIRECTORY_GROUPS']) saved[k] = process.env[k]
        process.env.PRIVILEGE_DIRECTORY_GROUPS = '["local:admins"]'
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
        process.env.USER_PROFILES_ENABLED = 'true'
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

    it('returns to the shared profile link after the sign-in it triggers', async () => {
        const j = new Map()
        const page = await openSignedOut(j, '/users/colleague')

        expect(page.status).toBe(200)
        expect(new URL(page.request.url).pathname).toBe('/users/colleague')
        expect(j.has('_return_to')).toBe(false)
    })

    it('shows a refined profile of another user', async () => {
        const j = new Map()
        await openSignedOut(j, '/')

        const res = await req(j, 'get', '/api/users/colleague')
        expect(res.status).toBe(200)
        expect(res.body).toEqual({
            username: 'colleague',
            type: 'person',
            name: 'colleague display',
            company: 'Example OÜ',
            email: 'colleague@example.com',
            roles: ['local:admins'],
            self: false,
        })
        expect((await req(j, 'get', '/api/users/testuser')).body.self).toBe(true)
        expect((await req(j, 'get', '/api/me')).body.userProfilesEnabled).toBe(true)
    })

    it('has no profile for unknown users, reserved names or malformed names', async () => {
        const j = new Map()
        await openSignedOut(j, '/')

        for (const name of ['nobody', 'reserved', 'UPPER', '..%2Foidcclients', '-x']) {
            expect((await req(j, 'get', `/api/users/${name}`)).status, name).toBe(404)
        }
    })

    it('answers nothing to a signed-out caller', async () => {
        const res = await req(new Map(), 'get', '/api/users/colleague')
        expect(res.status).toBe(404)
        expect(res.body).toEqual({})
    })

    it('serves no profiles while the feature is off', async () => {
        const j = new Map()
        await openSignedOut(j, '/')
        process.env.USER_PROFILES_ENABLED = 'false'

        expect((await req(j, 'get', '/api/users/colleague')).status).toBe(404)
        expect((await req(j, 'get', '/api/me')).body.userProfilesEnabled).toBe(false)
    })
})
