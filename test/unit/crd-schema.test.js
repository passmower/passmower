import {readFileSync} from 'node:fs'
import {describe, expect, it} from 'vitest'

const crds = readFileSync(new URL('../../charts/passmower/templates/crds.yaml', import.meta.url), 'utf8')

describe('OIDCUser CRD schema', () => {
    it('declares onboardedBy under passmower rather than an upstream identity', () => {
        const github = crds.slice(crds.indexOf('\n            github:'), crds.indexOf('\n            identities:'))
        const passmower = crds.slice(crds.indexOf('\n            passmower:'), crds.indexOf('\n            slack:'))

        expect(github).not.toContain('onboardedBy:')
        expect(passmower).toContain('onboardedBy:')
    })
})
