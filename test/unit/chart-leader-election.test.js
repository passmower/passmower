import {readFileSync} from 'node:fs'
import {load} from 'js-yaml'
import {describe, expect, it} from 'vitest'

const url = (file) => new URL(`../../charts/passmower/${file}`, import.meta.url)
const deployment = readFileSync(url('templates/deployment.yaml'), 'utf8')
const serviceAccount = readFileSync(url('templates/serviceaccount.yaml'), 'utf8')
const values = load(readFileSync(url('values.yaml'), 'utf8'))

// The operators are elected through a coordination.k8s.io Lease, so the chart
// has to supply both halves: an identity that differs between pods, and the
// RBAC to hold the Lease at all (#236).
describe('the chart wiring for leader election', () => {
    it('passes a per-Pod identity through the downward API', () => {
        // DEPLOYMENT_NAME is the same string in every replica, so it cannot say
        // which pod is which. metadata.name can.
        expect(deployment).toContain('name: POD_NAME')
        expect(deployment).toContain('fieldPath: metadata.name')
    })

    it('grants the Lease permissions the election needs', () => {
        // The template is Go, not YAML, so match the rule as written: the block
        // between this apiGroup and the next rule.
        const rule = serviceAccount.slice(
            serviceAccount.lastIndexOf('- verbs:', serviceAccount.indexOf('coordination.k8s.io')),
            serviceAccount.indexOf('coordination.k8s.io') + 200)
        expect(rule).toContain('- leases')
        for (const verb of ['get', 'create', 'update']) {
            expect(rule).toContain(`- ${verb}`)
        }
    })

    it('is on by default and switchable from values', () => {
        expect(values.passmower.leaderElection.enabled).toBe(true)
        expect(deployment).toContain('name: LEADER_ELECTION_ENABLED')
        expect(deployment).toContain('.Values.passmower.leaderElection.enabled')
    })

    // The point of the whole exercise: replicaCount above 1 is now a supported
    // configuration rather than a way to find out the operators race.
    it('no longer warns that replicaCount above 1 is unsafe', () => {
        const rawValues = readFileSync(url('values.yaml'), 'utf8')
        expect(rawValues).toContain('one replica at a time')
        expect(rawValues).not.toContain('not\n# leader-elected')
    })
})
