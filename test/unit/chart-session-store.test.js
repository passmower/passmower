import {readFileSync} from 'node:fs'
import {load} from 'js-yaml'
import {describe, expect, it} from 'vitest'

const redis = readFileSync(
    new URL('../../charts/passmower/templates/redis.yaml', import.meta.url), 'utf8')
const values = load(readFileSync(
    new URL('../../charts/passmower/values.yaml', import.meta.url), 'utf8'))
const compose = load(readFileSync(
    new URL('../../docker-compose.test.yml', import.meta.url), 'utf8'))
const workflow = load(readFileSync(
    new URL('../../.github/workflows/test.yml', import.meta.url), 'utf8'))

// The bundled store is Valkey: BSD-licensed, where the redis:7 line is
// RSALv2/SSPLv1, and this chart ships as open source.
describe('the bundled session store', () => {
    it('defaults to Valkey in values and in the template', () => {
        expect(values.redis.internal.image).toMatch(/^valkey\/valkey:/)
        expect(redis).toContain('default "valkey/valkey:8-alpine"')
    })

    it('invokes it through the redis-server name both images provide', () => {
        // Valkey ships redis-server as a symlink, so redis.internal.image can
        // be set back to a Redis image without touching anything else. A
        // valkey-specific command would quietly break that.
        expect(redis).toContain('- redis-server')
        expect(redis).not.toContain('valkey-server')
    })

    it('tests against the same store the chart bundles', () => {
        // Integration and e2e run on whatever this says; if it drifts from the
        // chart, CI stops covering what installations actually run.
        expect(compose.services.redis.image).toBe(values.redis.internal.image)
        expect(workflow.jobs.integration.services.redis.image).toBe(values.redis.internal.image)
    })

    it('keeps the redis-cli health check, which Valkey also provides', () => {
        expect(workflow.jobs.integration.services.redis.options).toContain('redis-cli ping')
    })
})
