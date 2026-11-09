import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'
import {fileURLToPath} from 'node:url'

const mocks = vi.hoisted(() => ({pins: new Map()}))

vi.mock('../../src/adapters/redis.js', () => ({
    default: class RedisAdapter {
        constructor(name) {
            this.name = name
        }
        async find(id) {
            return this.name === 'SessionGeo' ? mocks.pins.get(id) : undefined
        }
    },
}))

import configuration from '../../src/configuration.js'
import Account from '../../src/models/account.js'
import {resetGeoipReader} from '../../src/utils/geoip.js'

const GB = '81.2.69.142'
const SE = '89.160.20.112'

const eligibleAccount = () => new Account().fromKubernetes({
    metadata: {name: 'alice', labels: {}},
    spec: {},
    status: {
        profile: {name: 'Alice'},
        groups: [],
        conditions: [],
        termsOfService: {acceptedAt: '2026-08-21T10:00:00.000Z', contentHash: 'hash'},
    },
})

const ctxFor = (ip, tokenEndpointAuthMethod) => ({
    kubeOIDCUserService: {findUser: vi.fn().mockResolvedValue(eligibleAccount())},
    oidc: {client: {clientId: 'app', tokenEndpointAuthMethod}},
    headers: {'x-forwarded-for': ip},
})
const refreshToken = {kind: 'RefreshToken', sessionUid: 'session-uid'}

// A public client refreshes from the user's device, so its address is the
// user's; a confidential client refreshes from its backend, whose address says
// nothing about the user and is left to the session check.
describe('refresh grant geo-lock', () => {
    beforeEach(() => {
        resetGeoipReader()
        mocks.pins.set('session-uid', {country: 'GB'})
        globalThis.logger = {debug() {}, info() {}, warn() {}, error() {}, trace() {}}
        vi.stubEnv('GEOIP_DATABASE_PATH', fileURLToPath(new URL('../fixtures/geoip/GeoIP2-Country-Test.mmdb', import.meta.url)))
        vi.stubEnv('GEO_LOCK_ENABLED', 'true')
        vi.stubEnv('INCIDENTS_ENABLED', 'false')
    })

    afterEach(() => {
        vi.unstubAllEnvs()
        resetGeoipReader()
    })

    it('denies a public client refreshing from outside the session country', async () => {
        // undefined, not null: see find-account-contract.test.js.
        await expect(configuration.findAccount(ctxFor(SE, 'none'), 'alice', refreshToken)).resolves.toBeUndefined()
    })

    it('allows a public client refreshing from the session country', async () => {
        await expect(configuration.findAccount(ctxFor(GB, 'none'), 'alice', refreshToken))
            .resolves.toMatchObject({accountId: 'alice'})
    })

    it('leaves confidential clients to the session check', async () => {
        await expect(configuration.findAccount(ctxFor(SE, 'client_secret_basic'), 'alice', refreshToken))
            .resolves.toMatchObject({accountId: 'alice'})
    })

    it('ignores the country while geo-lock is off', async () => {
        vi.stubEnv('GEO_LOCK_ENABLED', 'false')
        await expect(configuration.findAccount(ctxFor(SE, 'none'), 'alice', refreshToken))
            .resolves.toMatchObject({accountId: 'alice'})
    })
})
