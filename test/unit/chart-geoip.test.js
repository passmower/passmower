import {readFileSync} from 'node:fs'
import {load} from 'js-yaml'
import {describe, expect, it} from 'vitest'

const deployment = readFileSync(
    new URL('../../charts/passmower/templates/deployment.yaml', import.meta.url), 'utf8')
const values = load(readFileSync(
    new URL('../../charts/passmower/values.yaml', import.meta.url), 'utf8'))

// Geo-lock (#315) and the GeoIP database it reads.
describe('GeoIP and geo-lock chart values', () => {
    it('ships both off, with the published DB-IP image as the database', () => {
        expect(values.passmower.geoip).toMatchObject({
            enabled: false,
            image: {reference: 'ghcr.io/passmower/geoip-country:latest'},
            volume: {},
            file: 'dbip-country-lite.mmdb',
        })
        expect(values.passmower.geoLock).toEqual({enabled: false, allowedCountries: []})
    })

    it('threads every env var the code reads', () => {
        for (const name of ['GEOIP_DATABASE_PATH', 'GEO_LOCK_ENABLED', 'GEO_LOCK_ALLOWED_COUNTRIES']) {
            expect(deployment).toContain(`- name: ${name}`)
        }
    })

    it('mounts the database where GEOIP_DATABASE_PATH points', () => {
        expect(deployment).toContain('printf "/var/lib/passmower/geoip/%s"')
        expect(deployment).toContain('mountPath: /var/lib/passmower/geoip')
    })

    it('refuses geo-lock without a database', () => {
        expect(deployment).toContain('passmower.geoLock.enabled requires passmower.geoip.enabled')
    })
})
