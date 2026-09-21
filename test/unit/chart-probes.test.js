import {readFileSync} from 'node:fs'
import {load} from 'js-yaml'
import {describe, expect, it} from 'vitest'

const url = (file) => new URL(`../../charts/passmower/${file}`, import.meta.url)
const deployment = readFileSync(url('templates/deployment.yaml'), 'utf8')
const values = load(readFileSync(url('values.yaml'), 'utf8'))

// Liveness must not depend on anything a restart cannot fix. Readiness must
// depend on everything serving a request needs. The chart had these the wrong
// way round, so a Redis restart terminated every pod at once (#265).
describe('the chart wiring for probes', () => {
    it('gives liveness the endpoint that checks nothing but the process', () => {
        expect(values.livenessProbe.httpGet).toMatchObject({path: '/health', port: 9090})
    })

    it('gives readiness the endpoint that checks the dependencies', () => {
        expect(values.readinessProbe.httpGet).toMatchObject({path: '/ready', port: 9090})
    })

    // The regression itself: a Redis outage restarts pods again the moment
    // liveness is pointed at the dependency check.
    it('never points liveness at the dependency check', () => {
        expect(values.livenessProbe.httpGet.path).not.toBe('/ready')
    })

    // Readiness used to hit the discovery document on 3000, which is how it
    // knew the provider had booted. Moving it to 9090 must not lose that, so
    // /ready reports not-ready until the main listener is up.
    it('keeps readiness off the provider port now that /ready covers booting', () => {
        expect(values.readinessProbe.httpGet.port).not.toBe(3000)
    })

    it('renders both probes from values so timings are tunable', () => {
        expect(deployment).toContain('with .Values.readinessProbe')
        expect(deployment).toContain('with .Values.livenessProbe')
        // `with` is what lets null drop a probe instead of rendering an empty key.
        expect(deployment).toContain('toYaml . | nindent 12')
    })

    it('ships timings that give a starting pod room without stalling rollouts', () => {
        expect(values.readinessProbe.periodSeconds).toBeLessThanOrEqual(values.livenessProbe.periodSeconds)
        expect(values.readinessProbe.initialDelaySeconds).toBeLessThanOrEqual(values.livenessProbe.initialDelaySeconds)
    })
})
