import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest'
import request from 'supertest'
import { fileURLToPath } from 'node:url'

vi.mock('../../src/adapters/kubernetes.js', () => import('../fakes/shared-kube.js'))
vi.mock('../../src/adapters/email.js', () => import('../fakes/email-capture.js'))

import { fakeKube } from '../fakes/shared-kube.js'
import { sentEmails } from '../fakes/email-capture.js'

// Address gate end to end (#342): Traefik's forwardAuth subrequest, the
// redirect to Passmower for an address no static rule allows, the sign-in, and
// the unlock that lets the address through until its session ends.
// Countries and ASNs come from MaxMind's test databases.
const GB = '81.2.69.142'      // country GB, no ASN record: only a session unlocks it
const SE = '89.160.20.112'    // country SE
const TELSTRA = '1.128.0.1'   // AS1221
const APP = 'https://app.example.com/inbox?folder=1'
const ISSUER_HOSTNAME = new URL(process.env.ISSUER_URL).hostname

const fixture = (name) => fileURLToPath(new URL(`../fixtures/geoip/${name}`, import.meta.url))

describe('address gate (HTTP)', () => {
    let callback
    const saved = {}
    const env = {
        ADDRESS_GATE_ENABLED: 'true',
        ADDRESS_GATE_ALLOWED_RANGES: '10.0.0.0/8',
        ADDRESS_GATE_ALLOWED_COUNTRIES: 'SE',
        ADDRESS_GATE_ALLOWED_ASNS: 'AS1221',
        GEOIP_DATABASE_PATH: fixture('GeoIP2-Country-Test.mmdb'),
        GEOIP_ASN_DATABASE_PATH: fixture('GeoLite2-ASN-Test.mmdb'),
    }

    beforeAll(async () => {
        for (const [k, v] of Object.entries(env)) {
            saved[k] = process.env[k]
            process.env[k] = v
        }
        process.env.REDIS_URI ??= 'redis://127.0.0.1:6379'
        process.env.EMAIL_ENABLED = 'true'
        globalThis.logger = { debug() {}, info() {}, warn() {}, error() {}, trace() {} }
        const { resetGeoipReader } = await import('../../src/utils/geoip.js')
        resetGeoipReader()
        const { buildProvider } = await import('../../src/app.js')
        callback = (await buildProvider()).callback()
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

    beforeEach(async () => {
        delete process.env.ADDRESS_GATE_SESSION_UNLOCK
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
        // Each test starts from a locked address.
        const { default: RedisAdapter } = await import('../../src/adapters/redis.js')
        const { addressKey } = await import('../../src/utils/ip-address.js')
        await new RedisAdapter('GateAddress').destroy(addressKey(GB))
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
    const browser = (ip) => ({ jar: new Map(), ip })
    async function req(b, method, path, form) {
        let r = request(callback)[method](path)
            .set('Cookie', cookieHeader(b.jar))
            .set('X-Forwarded-For', b.ip)
            .set('Accept', 'text/html')
        if (form) r = r.type('form').send(form)
        const res = await r
        store(b.jar, res)
        return res
    }
    // Follows redirects while they stay on Passmower; returns the first one
    // that leaves it.
    async function follow(b, res, maxHops = 16) {
        let cur = res
        for (let i = 0; i < maxHops && cur.status >= 300 && cur.status < 400; i++) {
            const u = new URL(cur.headers.location, process.env.ISSUER_URL)
            if (![ISSUER_HOSTNAME, '127.0.0.1'].includes(u.hostname)) return cur
            cur = await req(b, 'get', u.pathname + u.search)
        }
        return cur
    }

    // The subrequest Traefik's forwardAuth makes for a request to APP.
    const gate = (ip, { accept = 'text/html', method = 'GET' } = {}) => {
        const url = new URL(APP)
        return request(callback).get('/address-gate').set({
            'X-Forwarded-For': ip,
            'X-Forwarded-Proto': 'https',
            'X-Forwarded-Host': url.host,
            'X-Forwarded-Uri': url.pathname + url.search,
            'X-Forwarded-Method': method,
            Accept: accept,
        })
    }

    async function signInFromUnlock(b) {
        const denied = await gate(b.ip)
        expect(denied.status).toBe(302)
        let res = await follow(b, await req(b, 'get', new URL(denied.headers.location).pathname + new URL(denied.headers.location).search))
        const uid = (res.headers.location ?? res.request.url).match(/\/interaction\/([^/?]+)/)[1]
        await req(b, 'post', `/interaction/${uid}/email`, { email: 'test@example.com' })
        const link = sentEmails.at(-1).html.match(/\/interaction\/[^/]+\/verify-email\/[0-9a-f-]+/)[0]
        return follow(b, await req(b, 'get', link))
    }

    it('allows addresses matched by range, country and ASN', async () => {
        expect((await gate('10.20.30.40')).status).toBe(200)
        expect((await gate(SE)).status).toBe(200)
        expect((await gate(TELSTRA)).status).toBe(200)
    })

    it('sends a browser page load from an unknown address to Passmower', async () => {
        const res = await gate(GB)
        expect(res.status).toBe(302)
        const location = new URL(res.headers.location)
        expect(location.origin + location.pathname).toBe(`${process.env.ISSUER_URL}address-gate/unlock`)
        expect(location.searchParams.get('state')).toMatch(/^[\w-]+\.[\w-]+$/)
    })

    it('answers anything but a page load with a plain 403', async () => {
        expect((await gate(GB, { accept: 'application/json' })).status).toBe(403)
        expect((await gate(GB, { method: 'POST' })).status).toBe(403)
    })

    it('refuses a forged or tampered unlock state', async () => {
        const res = await req(browser(GB), 'get', '/address-gate/unlock?state=forged.state')
        expect(res.status).toBe(400)
    })

    it('unlocks the address through a sign-in and returns to the application', async () => {
        const b = browser(GB)
        const back = await signInFromUnlock(b)

        expect(back.status).toBe(302)
        expect(back.headers.location).toBe(APP)
        expect((await gate(GB)).status).toBe(200)
        // The pending-unlock cookie is spent.
        expect(b.jar.has('_address_gate')).toBe(false)
    })

    it('unlocks straight away for a browser already signed in', async () => {
        const b = browser(GB)
        await signInFromUnlock(b)
        const { default: RedisAdapter } = await import('../../src/adapters/redis.js')
        const { addressKey } = await import('../../src/utils/ip-address.js')
        await new RedisAdapter('GateAddress').destroy(addressKey(GB))

        const denied = await gate(GB)
        const location = new URL(denied.headers.location)
        const res = await req(b, 'get', location.pathname + location.search)
        expect(res.status).toBe(302)
        expect(res.headers.location).toBe(APP)
        expect((await gate(GB)).status).toBe(200)
    })

    // The application host can be reached over another address family than
    // Passmower: unlocking again would loop between the gate and the unlock.
    it('stops instead of looping when the unlocked address is refused again', async () => {
        const b = browser(GB)
        await signInFromUnlock(b)

        const denied = await gate('2001:db8::1')
        const location = new URL(denied.headers.location)
        const res = await req(b, 'get', location.pathname + location.search)
        expect(res.status).toBe(409)
        expect(res.text).toContain('different address')
    })

    it('closes the address again when the session ends', async () => {
        const b = browser(GB)
        await signInFromUnlock(b)
        expect((await gate(GB)).status).toBe(200)

        const { default: RedisAdapter } = await import('../../src/adapters/redis.js')
        await new RedisAdapter('Session').destroy(b.jar.get('_session'))
        expect((await gate(GB)).status).toBe(302)
    })

    it('only applies static rules when session unlocks are off', async () => {
        process.env.ADDRESS_GATE_SESSION_UNLOCK = 'false'
        expect((await gate(GB)).status).toBe(403)
        expect((await gate(SE)).status).toBe(200)
        expect((await req(browser(GB), 'get', '/address-gate/unlock?state=x')).status).toBe(404)
    })
})
