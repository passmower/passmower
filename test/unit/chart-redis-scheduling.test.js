import {readFileSync} from 'node:fs'
import {load} from 'js-yaml'
import {describe, expect, it} from 'vitest'

const redis = readFileSync(
    new URL('../../charts/passmower/templates/redis.yaml', import.meta.url), 'utf8')
const values = load(readFileSync(
    new URL('../../charts/passmower/values.yaml', import.meta.url), 'utf8'))

// The internal Redis holds every session and grant, so losing it signs everyone
// out at once — and with neither requests nor limits its pod is BestEffort,
// first in line for eviction under node memory pressure. It was the only
// workload in the release with no way to change that (#242).
describe('internal Redis scheduling knobs', () => {
    it('threads resources into the container', () => {
        expect(redis).toContain('toYaml .Values.redis.internal.resources')
    })

    it('threads the scheduling knobs the main Deployment has', () => {
        for (const knob of ['nodeSelector', 'affinity', 'tolerations', 'priorityClassName']) {
            expect(redis).toContain(`.Values.redis.internal.${knob}`)
        }
    })

    it('declares every knob in values.yaml, so toYaml cannot render null', () => {
        const internal = values.redis.internal

        expect(internal.resources).toEqual({})
        expect(internal.nodeSelector).toEqual({})
        expect(internal.affinity).toEqual({})
        expect(internal.tolerations).toEqual([])
        expect(internal.priorityClassName).toBe('')
    })

    it('leaves the defaults empty so an upgrade cannot move an existing pod', () => {
        // A default request would change where the pod can schedule on upgrade,
        // which is not something a patch release should do behind the operator's
        // back; the commented example in values.yaml suggests one instead.
        expect(values.redis.internal.resources).toEqual({})
        expect(redis).not.toMatch(/memory:\s*\d/)
    })
})
