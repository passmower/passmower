import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import request from 'supertest'
import { generateKeyPairSync } from 'node:crypto'
import * as jose from 'jose'

// Replace the Kubernetes adapter before the app is imported.
vi.mock('../../src/adapters/kubernetes.js', () => import('../fakes/shared-kube.js'))

import { fakeKube } from '../fakes/shared-kube.js'

// Production keys (from oidc-key-manager) carry no kid/alg; oidc-provider then
// signs access tokens with the RFC 7638 thumbprint as kid. Override the setup
// key with that exact shape so the bearer JWT verification in accountFromBearer
// is tested against what production actually issues (regression: JWKSNoMatchingKey).
const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })
const bareJwk = privateKey.export({ format: 'jwk' })
bareJwk.use = 'sig'
process.env.OIDC_JWKS = JSON.stringify([bareJwk])

// The /api/apps/all admin gate matches profile group displayNames.
process.env.ADMIN_GROUP = 'github.com:testorg:admins'

const ISSUER = process.env.ISSUER_URL
const ADMIN_GROUP = { prefix: 'github.com', name: 'testorg:admins' }

const seedUser = (name, groups = []) => {
    fakeKube.seed('OIDCUser', {
        metadata: { name, labels: {} },
        spec: { email: `${name}@example.com`, name },
        passmower: { email: `${name}@example.com` },
        status: {
            primaryEmail: `${name}@example.com`,
            emails: [`${name}@example.com`],
            groups,
            profile: { name },
            conditions: [{ type: 'ToSv1', status: 'True' }],
        },
    })
}

describe('apps list API over bearer access tokens (HTTP)', () => {
    let agent
    let signingKey
    let kid

    // Mirrors how oidc-provider mints resource-bound JWT access tokens:
    // RS256, typ at+jwt, kid = key thumbprint, iss = provider issuer.
    const mint = async ({ sub, scope, key = signingKey, headerKid = kid, iss = ISSUER } = {}) => {
        return await new jose.SignJWT({ scope, client_id: 'some-rp' })
            .setProtectedHeader({ alg: 'RS256', typ: 'at+jwt', kid: headerKid })
            .setIssuer(iss)
            .setAudience('https://some-api')
            .setSubject(sub)
            .setIssuedAt()
            .setExpirationTime('5m')
            .sign(key)
    }

    const bearer = (token) => ({ Authorization: `Bearer ${token}` })

    beforeAll(async () => {
        process.env.REDIS_URI ??= 'redis://127.0.0.1:6379'
        globalThis.logger = { debug() {}, info() {}, warn() {}, error() {}, trace() {} }

        signingKey = await jose.importJWK(bareJwk, 'RS256')
        const { d, p, q, dp, dq, qi, ...publicJwk } = bareJwk
        kid = await jose.calculateJwkThumbprint(publicJwk)

        const { buildProvider } = await import('../../src/app.js')
        const provider = await buildProvider()
        agent = request(provider.callback())

        // Enroll apps directly in Redis, mirroring what the client operator
        // does (upsert into the 'Client' model maintains the 'Clients' set).
        const { default: RedisAdapter } = await import('../../src/adapters/redis.js')
        const clientRedis = new RedisAdapter('Client')
        await clientRedis.upsert('app-open', {
            client_id: 'app-open',
            client_name: 'app-open',
            displayName: 'Open App',
            uri: 'https://open.test/',
            allowedGroups: [],
        })
        await clientRedis.upsert('app-gated', {
            client_id: 'app-gated',
            client_name: 'app-gated',
            displayName: 'Gated App',
            uri: 'https://gated.test/',
            allowedGroups: ['github.com:testorg:admins'],
        })
        await clientRedis.upsert('app-user-gated', {
            client_id: 'app-user-gated',
            client_name: 'app-user-gated',
            displayName: 'User Gated App',
            uri: 'https://user-gated.test/',
            allowedGroups: [],
            allowedUsers: ['plain-user'],
        })
        // Not launchable (no uri) — must never be listed.
        await clientRedis.upsert('app-headless', {
            client_id: 'app-headless',
            client_name: 'app-headless',
            allowedGroups: [],
        })

        seedUser('plain-user')
        seedUser('admin-user', [ADMIN_GROUP])
    })

    afterAll(async () => {
        const { disconnect } = await import('../../src/adapters/redis.js')
        await disconnect()
    })

    describe('GET /api/apps (launcher list, `applications` scope)', () => {
        it('rejects anonymous callers', async () => {
            await agent.get('/api/apps').expect(401)
        })

        it('rejects garbage bearer tokens', async () => {
            await agent.get('/api/apps').set(bearer('not-a-token')).expect(401)
        })

        it('rejects tokens signed by a foreign key', async () => {
            const { privateKey: foreignKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })
            const foreign = await jose.importJWK(foreignKey.export({ format: 'jwk' }), 'RS256')
            const token = await mint({ sub: 'plain-user', scope: 'openid applications', key: foreign })
            await agent.get('/api/apps').set(bearer(token)).expect(401)
        })

        it('rejects tokens without the `applications` scope', async () => {
            const token = await mint({ sub: 'plain-user', scope: 'openid profile groups' })
            await agent.get('/api/apps').set(bearer(token)).expect(403)
        })

        it('lists the apps the caller can access, without session metadata', async () => {
            const token = await mint({ sub: 'plain-user', scope: 'openid applications' })
            const res = await agent.get('/api/apps').set(bearer(token)).expect(200)

            const names = res.body.apps.map(a => a.name)
            expect(names).toContain('Open App')
            expect(names).toContain('User Gated App')
            // group-gated app is hidden from users outside the group
            expect(names).not.toContain('Gated App')
            // clients without a uri are not launchable apps
            expect(names).not.toContain('app-headless')

            const open = res.body.apps.find(a => a.name === 'Open App')
            expect(open).toMatchObject({ url: 'https://open.test/', groups: [] })
            // last-login metadata is bound to the site session; bearer callers get none
            expect(open.metadata).toBeNull()
        })

        it('includes group-gated apps for members of the group', async () => {
            const token = await mint({ sub: 'admin-user', scope: 'openid applications' })
            const res = await agent.get('/api/apps').set(bearer(token)).expect(200)

            const gated = res.body.apps.find(a => a.name === 'Gated App')
            expect(gated).toMatchObject({
                url: 'https://gated.test/',
                groups: ['github.com:testorg:admins'],
            })
            expect(res.body.apps.map(a => a.name)).not.toContain('User Gated App')
        })
    })

    describe('GET /api/apps/all (admin catalog, `all_applications` scope)', () => {
        it('rejects tokens without the `all_applications` scope', async () => {
            const token = await mint({ sub: 'admin-user', scope: 'openid applications' })
            await agent.get('/api/apps/all').set(bearer(token)).expect(403)
        })

        it('rejects non-admin users even with the scope', async () => {
            const token = await mint({ sub: 'plain-user', scope: 'openid all_applications' })
            await agent.get('/api/apps/all').set(bearer(token)).expect(403)
        })

        it('returns every enrolled app with accessibility flags for admins', async () => {
            const token = await mint({ sub: 'admin-user', scope: 'openid all_applications' })
            const res = await agent.get('/api/apps/all').set(bearer(token)).expect(200)

            const byName = Object.fromEntries(res.body.apps.map(a => [a.name, a]))
            expect(byName['Open App'].accessible).toBe(true)
            expect(byName['Gated App'].accessible).toBe(true)
            expect(byName['User Gated App'].accessible).toBe(false)
            expect(byName['app-headless']).toBeUndefined()
        })
    })
})
