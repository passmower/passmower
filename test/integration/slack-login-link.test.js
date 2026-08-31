import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest'
import request from 'supertest'

// Slack has to be stubbed at the SDK boundary (and SLACK_TOKEN set) before the
// app is imported: SlackAdapter reads the token in its constructor, and
// EmailLogin builds one at wiring time.
process.env.SLACK_TOKEN = 'xoxb-test-token'

export const slackCalls = { postMessage: [] }

vi.mock('../../src/adapters/kubernetes.js', () => import('../fakes/shared-kube.js'))
vi.mock('../../src/adapters/email.js', () => import('../fakes/email-capture.js'))
vi.mock('@slack/web-api', () => ({
    WebClient: class {
        chat = {
            postMessage: async (payload) => {
                slackCalls.postMessage.push(payload)
                return { ok: true }
            },
        }
        auth = { test: async () => ({ team_id: 'T123' }) }
        users = { lookupByEmail: async () => ({ user: { id: 'U-looked-up' } }) }
    },
}))

import { fakeKube } from '../fakes/shared-kube.js'
import { sentEmails } from '../fakes/email-capture.js'

const RP = {
    client_id: 'grafana',
    client_secret: 'grafana-secret',
    redirect_uri: 'https://grafana.test/login/generic_oauth',
}

describe('login link over Slack (HTTP)', () => {
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
            displayName: 'Grafana',
        })
    })

    afterAll(async () => {
        const { disconnect } = await import('../../src/adapters/redis.js')
        await disconnect()
        delete process.env.SLACK_TOKEN
    })

    beforeEach(() => {
        fakeKube.store.clear()
        sentEmails.length = 0
        slackCalls.postMessage.length = 0
        fakeKube.seed('OIDCUser', {
            metadata: { name: 'testuser', labels: {} },
            spec: {
                email: 'test@example.com', name: 'Test User',
                groups: [{ prefix: 'local', name: 'staff' }],
            },
            passmower: { email: 'test@example.com' },
            slack: { id: 'U-testuser' },
            status: {
                primaryEmail: 'test@example.com',
                emails: ['test@example.com'],
                groups: [{ prefix: 'local', name: 'staff' }],
                profile: { name: 'Test User' },
                slackId: 'U-testuser',
                conditions: [],
                termsOfService: {
                    acceptedAt: '2026-08-06T12:00:00.000Z',
                    contentHash: 'test-content-hash',
                },
            },
        })
    })

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
    async function follow(j, res, maxHops = 12) {
        let cur = res
        for (let i = 0; i < maxHops && cur.status >= 300 && cur.status < 400; i++) {
            const loc = cur.headers.location
            if (!loc) break
            const u = loc.startsWith('http') ? new URL(loc) : new URL(loc, process.env.ISSUER_URL)
            if (u.host === new URL(RP.redirect_uri).host) return cur
            cur = await req(j, 'get', u.pathname + u.search)
        }
        return cur
    }

    async function requestLoginLink() {
        const j = jar()
        const authQuery = new URLSearchParams({
            client_id: RP.client_id,
            redirect_uri: RP.redirect_uri,
            response_type: 'code',
            scope: 'openid email',
            state: 'state-17',
        })
        const res = await follow(j, await req(j, 'get', `/auth?${authQuery}`))
        const uid = (res.headers.location ?? res.request.url).match(/\/interaction\/([^/?]+)/)[1]
        return req(j, 'post', `/interaction/${uid}/email`, { email: 'test@example.com' })
    }

    it('DMs the link as a Block Kit button, with the email body as fallback text', async () => {
        await requestLoginLink()

        expect(slackCalls.postMessage).toHaveLength(1)
        const dm = slackCalls.postMessage[0]
        expect(dm.channel).toBe('U-testuser')

        const button = dm.blocks.find(b => b.type === 'actions').elements[0]
        const emailedLink = sentEmails[0].text.match(/https:\S+verify-email\/[0-9a-f-]+/)[0]
        // Same one-time link the email carries — on a button instead of inline.
        expect(button.url).toBe(emailedLink)
        expect(button.text.text).toBe('Sign in')

        // Slack needs text for the notification and blocks-less clients.
        expect(dm.text).toContain('verify-email/')
        expect(dm.blocks.find(b => b.type === 'section').text.text)
            .toBe('Sign in to *Grafana* as test@example.com')
    })

    it('still sends the email, and both channels are reported to the user', async () => {
        const res = await requestLoginLink()

        expect(sentEmails).toHaveLength(1)
        expect(res.headers.location).toContain('email=true')
        expect(res.headers.location).toContain('slack=true')
    })

    it('skips the DM for an account with no linked Slack user', async () => {
        const user = fakeKube.store.get('OIDCUser/testuser')
        delete user.slack
        delete user.status.slackId

        const res = await requestLoginLink()

        expect(slackCalls.postMessage).toHaveLength(0)
        expect(sentEmails).toHaveLength(1)
        expect(res.headers.location).toContain('slack=false')
    })
})
