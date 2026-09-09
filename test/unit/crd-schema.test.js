import {readFileSync} from 'node:fs'
import {describe, expect, it} from 'vitest'
import {loadAll} from 'js-yaml'
import configuration from '../../src/configuration.js'

const crds = readFileSync(new URL('../../charts/passmower/templates/crds.yaml', import.meta.url), 'utf8')

describe('OIDCUser CRD schema', () => {
    it('declares onboardedBy under passmower rather than an upstream identity', () => {
        const github = crds.slice(crds.indexOf('\n            github:'), crds.indexOf('\n            identities:'))
        const passmower = crds.slice(crds.indexOf('\n            passmower:'), crds.indexOf('\n            slack:'))

        expect(github).not.toContain('onboardedBy:')
        expect(passmower).toContain('onboardedBy:')
    })

    it('declares the admin approval marker as a boolean under passmower', () => {
        // Approval is recorded here rather than by granting the required group,
        // so the field has to exist on every served version or the write is
        // pruned and approving silently does nothing again (#235).
        const oidcUserCrd = loadAll(crds).find(doc => doc?.metadata?.name === 'oidcusers.codemowers.cloud')

        for (const version of oidcUserCrd.spec.versions) {
            const passmower = version.schema.openAPIV3Schema.properties.passmower.properties
            expect(passmower.approved.type).toBe('boolean')
        }
    })

    it('declares Terms of Service acceptance in status rather than spec', () => {
        const oidcUserSchema = crds.slice(crds.indexOf('&oidcUserSchema'), crds.indexOf('\n    additionalPrinterColumns:', crds.indexOf('&oidcUserSchema')))
        const specStart = oidcUserSchema.indexOf('\n            spec:')
        const statusStart = oidcUserSchema.indexOf('\n            status:')
        const spec = oidcUserSchema.slice(specStart, statusStart)
        const status = oidcUserSchema.slice(statusStart)

        expect(spec).not.toContain('termsOfService:')
        expect(status).toContain('termsOfService:')
    })
})

describe('OIDCClient CRD schema', () => {
    // Parse rather than string-match: the enum values that went missing in
    // 746ebc9 were still literally present in the file, just folded into the
    // preceding description as a multi-line plain scalar.
    const oidcClientCrd = loadAll(crds).find(doc => doc?.metadata?.name === 'oidcclients.codemowers.cloud')

    it.each(oidcClientCrd.spec.versions.map(version => version.name))(
        '%s declares claimMappings as claim-name-keyed rule sets',
        (versionName) => {
            const version = oidcClientCrd.spec.versions.find(v => v.name === versionName)
            const mapping = version.schema.openAPIV3Schema.properties.spec.properties
                .claimMappings.additionalProperties

            expect(mapping.properties.default.type).toBe('string')
            expect(mapping.properties.rules.items.required).toEqual(['value'])
            expect(mapping.properties.rules.items.properties.value.type).toBe('string')
            expect(mapping.properties.rules.items.properties.groups.items.type).toBe('string')
        }
    )

    it.each(oidcClientCrd.spec.versions.map(version => version.name))(
        '%s offers every scope the provider supports in availableScopes',
        (versionName) => {
            const version = oidcClientCrd.spec.versions.find(v => v.name === versionName)
            const availableScopes = version.schema.openAPIV3Schema.properties.spec.properties.availableScopes

            // oidc-provider derives its scopes from `scopes` plus every `claims`
            // key that maps to a set of claims (helpers/configuration.js
            // collectScopes), so this is the full set a client may request.
            const claimDefinedScopes = Object.entries(configuration.claims)
                .filter(([, claims]) => Array.isArray(claims))
                .map(([scope]) => scope)
            const supportedScopes = new Set([...configuration.scopes, ...claimDefinedScopes])

            expect(new Set(availableScopes.items.enum)).toEqual(supportedScopes)
        }
    )
})
