import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import request from 'supertest'

// Logging out of a sign-in page leaves GitHub signed in, so choosing GitHub
// again would silently return the same account. The next upstream sign-in
// after a logout asks GitHub for its account picker; later ones do not.
describe('upstream account picker after logout (HTTP)', () => {
    let callback
    const githubEnabled = process.env.GITHUB_ENABLED

    beforeAll(async () => {
        process.env.REDIS_URI ??= 'redis://127.0.0.1:6379'
        process.env.GITHUB_ENABLED = 'true'
        process.env.GH_CLIENT_ID ??= 'test-gh-client'
        process.env.GH_CLIENT_SECRET ??= 'test-gh-secret'
        globalThis.logger = { debug() {}, info() {}, warn() {}, error() {}, trace() {} }
        const { buildProvider } = await import('../../src/app.js')
        callback = (await buildProvider()).callback()
    })

    afterAll(async () => {
        process.env.GITHUB_ENABLED = githubEnabled
        const { disconnect } = await import('../../src/adapters/redis.js')
        await disconnect()
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
    // Open the dashboard sign-in and return the interaction uid.
    async function openSignIn(j) {
        const query = new URLSearchParams({
            client_id: 'passmower', response_type: 'id_token', scope: 'openid',
            nonce: 'n', redirect_uri: process.env.ISSUER_URL,
        })
        const res = await req(j, 'get', `/auth?${query}`)
        return res.headers.location.match(/\/interaction\/([^/?]+)/)[1]
    }
    async function githubAuthorize(j) {
        const uid = await openSignIn(j)
        const res = await req(j, 'post', `/interaction/${uid}/federated`, { upstream: 'gh' })
        expect(res.status).toBe(302)
        const url = new URL(res.headers.location)
        expect(url.host).toBe('github.com')
        return url.searchParams
    }

    it('does not ask for the picker on an ordinary sign-in', async () => {
        expect((await githubAuthorize(new Map())).get('prompt')).toBeNull()
    })

    it('asks for the picker once, on the first upstream sign-in after logging out', async () => {
        const j = new Map()
        const uid = await openSignIn(j)
        await req(j, 'get', `/interaction/${uid}/abort`)
        expect(j.has('_select_account')).toBe(true)

        expect((await githubAuthorize(j)).get('prompt')).toBe('select_account')
        expect(j.has('_select_account')).toBe(false)
        expect((await githubAuthorize(j)).get('prompt')).toBeNull()
    })

    it('ignores an unsigned marker cookie', async () => {
        const j = new Map([['_select_account', '1']])
        expect((await githubAuthorize(j)).get('prompt')).toBeNull()
    })
})
