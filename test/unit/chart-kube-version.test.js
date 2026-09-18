import {readFileSync} from 'node:fs'
import {load} from 'js-yaml'
import {describe, expect, it} from 'vitest'

const url = (file) => new URL(`../../charts/passmower/${file}`, import.meta.url)
const chart = load(readFileSync(url('Chart.yaml'), 'utf8'))
const crds = readFileSync(url('templates/crds.yaml'), 'utf8')

describe('the chart kubeVersion floor', () => {
    it('is declared, so an unsupported cluster is refused rather than half-configured', () => {
        expect(chart.kubeVersion).toBeDefined()
    })

    // Without -0, semver reads a distribution's prerelease version — GKE's
    // 1.28.3-gke.1286000, say — as below 1.25.0, and the chart refuses a
    // cluster that is fine.
    it('admits prerelease versions from distributions', () => {
        expect(chart.kubeVersion).toMatch(/-0\s*$/)
    })

    // The floor exists for the CEL rule on OIDCClient: an API server older than
    // 1.25 prunes x-kubernetes-validations silently, so the client would install
    // with the redirectUris/ingressRef constraint quietly absent. Every other
    // requirement is older — coordination.k8s.io/v1 Leases 1.14, Job
    // ttlSecondsAfterFinished 1.23, networking.k8s.io/v1 Ingress 1.19,
    // apiextensions.k8s.io/v1 CRDs 1.16.
    it('is at least the version the CRDs need', () => {
        expect(crds).toContain('x-kubernetes-validations')
        const [, minor] = chart.kubeVersion.match(/>=1\.(\d+)\./)
        expect(Number(minor)).toBeGreaterThanOrEqual(25)
    })
})
