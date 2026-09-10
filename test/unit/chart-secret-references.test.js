import {readFileSync} from 'node:fs'
import {load} from 'js-yaml'
import {describe, expect, it} from 'vitest'

// deployment.yaml is a Go template, so it is asserted as text; values.yaml is
// plain YAML.
const deployment = readFileSync(
    new URL('../../charts/passmower/templates/deployment.yaml', import.meta.url), 'utf8')
const values = load(readFileSync(
    new URL('../../charts/passmower/values.yaml', import.meta.url), 'utf8'))

// The redis-operator derives its Secret name from the RedisClaim with a plural
// suffix. The chart shipped the singular in the redisClaim branch while its own
// `external` default used the plural, so `redisClaim.enabled: true` produced a
// pod stuck in CreateContainerConfigError on a Secret nobody creates — with the
// claim Bound and the install otherwise clean.
describe('generated redis Secret references', () => {
    it('uses the plural owner-secrets suffix in the redisClaim branch', () => {
        const claimBranch = deployment.slice(
            deployment.indexOf('.Values.redis.redisClaim.enabled'),
            deployment.indexOf('.Values.redis.external.enabled'),
        )

        expect(claimBranch).toContain('-owner-secrets')
        expect(claimBranch).not.toMatch(/-owner-secret\b(?!s)/)
    })

    it('agrees with the suffix the external default documents', () => {
        // Both branches point at the same operator-managed Secret, so a
        // divergence between them means one of the two cannot resolve.
        expect(values.redis.external.secretKeyRef.name).toMatch(/-owner-secrets$/)
    })

    it('reads the same key on both paths', () => {
        expect(values.redis.external.secretKeyRef.key).toBe('REDIS_MASTER_0_URI')
        expect(deployment).toContain('key: REDIS_MASTER_0_URI')
    })
})
