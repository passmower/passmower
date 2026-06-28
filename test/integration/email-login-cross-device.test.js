import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest'
import request from 'supertest'
import { createHash, randomBytes } from 'node:crypto'

vi.mock('../../src/adapters/kubernetes.js', () => import('../fakes/shared-kube.js'))
vi.mock('../../src/adapters/email.js', () => import('../fakes/email-capture.js'))

import { fakeKube } from '../fakes/shared-kube.js'
import { sentEmails } from '../fakes/email-capture.js'

const ISSUER = process.env.ISSUER_URL
const RP = { client_id: 'xd-rp', client_secret: 'xd-secret', redirect_uri: 'https://rp.test/cb' }
const b64url = (buf) => buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')

// "Original device continues": opening the magic link on another device/browser
// only marks the email verified; the original device polls and completes (#).
describe('cross-device email magic link', () => {
    let callback

    beforeAll(async () => {
        process.env.REDIS_URI ??= 'redis://127.0.0.1:6379'
        process.env.EMAIL_ENABLED = 'true'
        globalThis.logger = { debug() {}, info() {}, warn() {}, error() {}, trace() {} }
        const { buildProvider } = await import('../../src/app.js')
        callback = (await buildProvider()).callback()
        const { default: RedisAdapter } = await import('../../src/adapters/redis.js')
        await new RedisAdapter('Client').upsert(RP.client_id, {
            client_id: RP.client_id, client_secret: RP.client_secret, redirect_uris: [RP.redirect_uri],
            grant_types: ['authorization_code'], response_types: ['code'],
            token_endpoint_auth_method: 'client_secret_basic', availableScopes: ['openid'], allowedCORSOrigins: [],
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
            metadata: { name: 'xduser', labels: {} },
            spec: { email: 'xd@example.com', name: 'XD User' },
            passmower: { email: 'xd@example.com' },
            status: {
                primaryEmail: 'xd@example.com', emails: ['xd@example.com'], groups: [],
                profile: { name: 'XD User' }, conditions: [{ type: 'ToSv1', status: 'True' }],
            },
        })
    })

    // minimal cookie jar
    const cookieHeader = (j) => [...j.entries()].map(([k, v]) => `${k}=${v}`).join('; ')
    const store = (j, res) => {
        for (const c of res.headers['set-cookie'] ?? []) {
            const pair = c.split(';')[0]; const i = pair.indexOf('=')
            const name = pair.slice(0, i).trim(); const val = pair.slice(i + 1)
            if (val === '') j.delete(name); else j.set(name, val)
        }
    }
    async function req(j, method, path, form) {
        let r = request(callback)[method](path).set('Cookie', j ? cookieHeader(j) : '')
        if (form) r = r.type('form').send(form)
        const res = await r
        if (j) store(j, res)
        return res
    }
    async function follow(j, res, rpHost, max = 12) {
        let cur = res
        for (let i = 0; i < max && cur.status >= 300 && cur.status < 400; i++) {
            const loc = cur.headers.location
            const u = loc.startsWith('http') ? new URL(loc) : new URL(loc, ISSUER)
            if (u.host === rpHost) return cur
            cur = await req(j, 'get', u.pathname + u.search)
        }
        return cur
    }

    it('verifies on another device and completes on the original device', async () => {
        const j = new Map() // original device A
        const verifier = b64url(randomBytes(32))
        const challenge = b64url(createHash('sha256').update(verifier).digest())
        const authQuery = new URLSearchParams({
            client_id: RP.client_id, redirect_uri: RP.redirect_uri, response_type: 'code', scope: 'openid',
            state: 'st', nonce: 'no', code_challenge: challenge, code_challenge_method: 'S256',
        })

        // A starts the flow and submits the email
        let res = await follow(j, await req(j, 'get', `/auth?${authQuery}`), 'rp.test')
        const uid = (res.headers.location ?? res.request.url).match(/\/interaction\/([^/?]+)/)[1]
        res = await req(j, 'post', `/interaction/${uid}/email`, { email: 'xd@example.com' })
        const linkPath = sentEmails[0].html.match(/\/interaction\/[^/]+\/verify-email\/[0-9a-f-]+/)[0]

        // Link opened on ANOTHER device (no cookies): only verifies, does not redirect
        const onOtherDevice = await req(null, 'get', linkPath)
        expect(onOtherDevice.status).toBe(200)
        expect(onOtherDevice.text).toMatch(/verified|return/i)

        // Original device's poll now sees it verified
        const status = await req(null, 'get', `/interaction/${uid}/email-status`)
        expect(status.body).toEqual({ verified: true })

        // Original device (with its cookies) completes the login
        res = await req(j, 'get', `/interaction/${uid}/email-complete`)
        const final = await follow(j, res, 'rp.test')
        const loc = final.headers.location ?? ''
        expect(loc).toContain(RP.redirect_uri)
        const code = new URL(loc).searchParams.get('code')
        expect(code).toBeTruthy()

        const tokenRes = await request(callback).post('/token').auth(RP.client_id, RP.client_secret).type('form').send({
            grant_type: 'authorization_code', code, redirect_uri: RP.redirect_uri, code_verifier: verifier,
        }).expect(200)
        const claims = JSON.parse(Buffer.from(tokenRes.body.id_token.split('.')[1], 'base64url').toString())
        expect(claims.sub).toBe('xduser')
    })

    it('reports not-verified before the link is opened', async () => {
        const j = new Map()
        const authQuery = new URLSearchParams({
            client_id: RP.client_id, redirect_uri: RP.redirect_uri, response_type: 'code', scope: 'openid',
            state: 'st2', nonce: 'no2', code_challenge: 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM', code_challenge_method: 'S256',
        })
        let res = await follow(j, await req(j, 'get', `/auth?${authQuery}`), 'rp.test')
        const uid = (res.headers.location ?? res.request.url).match(/\/interaction\/([^/?]+)/)[1]
        await req(j, 'post', `/interaction/${uid}/email`, { email: 'xd@example.com' })
        const status = await req(null, 'get', `/interaction/${uid}/email-status`)
        expect(status.body).toEqual({ verified: false })
    })
})
