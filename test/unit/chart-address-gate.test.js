import {readFileSync} from 'node:fs'
import {load} from 'js-yaml'
import {describe, expect, it} from 'vitest'

const read = (path) => readFileSync(new URL(`../../charts/passmower/${path}`, import.meta.url), 'utf8')
const deployment = read('templates/deployment.yaml')
const gate = read('templates/address-gate.yaml')
const values = load(read('values.yaml'))

// Address gate (#342) and the ASN database it can match on.
describe('address gate chart values', () => {
    it('ships off, with every rule empty and the policy disabled', () => {
        expect(values.passmower.addressGate).toMatchObject({
            enabled: false,
            allowedCountries: [],
            allowedAsns: [],
            allowedRanges: [],
            sessionUnlock: true,
            middleware: {enabled: true},
            admissionPolicy: {enabled: false, namespaceSelector: {}, failurePolicy: 'Fail'},
        })
        expect(values.passmower.geoip.asn).toMatchObject({
            enabled: false,
            image: {reference: 'ghcr.io/passmower/geoip-asn:latest'},
            file: 'dbip-asn-lite.mmdb',
        })
    })

    it('threads every env var the code reads', () => {
        for (const name of [
            'ADDRESS_GATE_ENABLED', 'ADDRESS_GATE_ALLOWED_COUNTRIES', 'ADDRESS_GATE_ALLOWED_ASNS',
            'ADDRESS_GATE_ALLOWED_RANGES', 'ADDRESS_GATE_SESSION_UNLOCK', 'GEOIP_ASN_DATABASE_PATH',
        ]) {
            expect(deployment).toContain(`- name: ${name}`)
        }
        expect(deployment).toContain('mountPath: /var/lib/passmower/geoip-asn')
    })

    it('refuses rules without the database they need', () => {
        expect(deployment).toContain('passmower.addressGate.allowedCountries requires passmower.geoip.enabled')
        expect(deployment).toContain('passmower.addressGate.allowedAsns requires passmower.geoip.asn.enabled')
    })

    it('points the forwardAuth middleware at the gate endpoint', () => {
        expect(gate).toContain('kind: Middleware')
        expect(gate).toMatch(/address: http:\/\/.*\/address-gate$/m)
    })

    it('never gates Passmower itself or an exempt Ingress', () => {
        expect(gate).toContain('name: not-passmower')
        expect(gate).toContain("'codemowers.cloud/address-gate'] == 'exempt'")
    })
})
