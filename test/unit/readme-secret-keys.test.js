import {readFileSync} from 'node:fs'
import {describe, expect, it} from 'vitest'
import * as constants from '../../src/utils/kubernetes/kube-constants.js'

const readme = readFileSync(new URL('../../README.md', import.meta.url), 'utf8')

// Every OIDC_* key the generated client Secret carries, from the constants the
// model writes it with.
const secretKeys = new Set(
    Object.entries(constants)
        .filter(([name, value]) => /^OIDCClientSecret.*Key$/.test(name) && typeof value === 'string')
        .map(([, value]) => value)
)

// The README is what a new integration is written from, and it named
// OIDC_GATEWAY_AUTH_URI — a 1.x key that no longer exists — long after the
// rename to OIDC_IDP_*. Copying it verbatim yields
// CreateContainerConfigError on a key that is not in the Secret.
describe('README references only keys the generated Secret carries', () => {
    it('documents no unknown OIDC_* secret key', () => {
        const referenced = [...readme.matchAll(/^\s*(?:key: |\| `)(OIDC_[A-Z0-9_]+)/gm)]
            .map(match => match[1])

        expect(referenced.length).toBeGreaterThan(0)
        expect([...new Set(referenced.filter(key => !secretKeys.has(key)))]).toEqual([])
    })

    it('carries no leftover 1.x OIDC_GATEWAY_* names', () => {
        expect(readme).not.toContain('OIDC_GATEWAY')
    })

    it('enumerates the full key set', () => {
        // The README used to show three of the fifteen with nowhere listing the
        // rest; keep the table complete as keys are added.
        for (const key of secretKeys) {
            expect(readme).toContain(`\`${key}\``)
        }
    })
})
