import {describe, expect, it} from 'vitest'
import Provider from 'oidc-provider'
import instance from 'oidc-provider/lib/helpers/weak_cache.js'
import configuration from '../../src/configuration.js'
import {
    evaluateClaimMappings,
    mappedClaimsFor,
    registerMappedClaims,
    validateClaimMappings,
} from '../../src/utils/claim-mappings.js'

const immichRole = {
    immich_role: {
        default: 'user',
        rules: [{value: 'admin', groups: ['github:admins', 'github:platform']}],
    },
}

describe('claim mapping evaluation', () => {
    it('emits the first matching rule and falls back to the default', () => {
        const mappings = {
            grafana_role: {
                default: 'Viewer',
                rules: [
                    {value: 'Admin', groups: ['github:admins']},
                    {value: 'Editor', groups: ['github:devs']},
                ],
            },
        }

        expect(evaluateClaimMappings(mappings, ['github:devs'])).toEqual({grafana_role: 'Editor'})
        // Rule order decides, not group order.
        expect(evaluateClaimMappings(mappings, ['github:devs', 'github:admins']))
            .toEqual({grafana_role: 'Admin'})
        expect(evaluateClaimMappings(mappings, ['github:everyone']))
            .toEqual({grafana_role: 'Viewer'})
    })

    it('omits the claim when nothing matches and there is no default', () => {
        const mappings = {immich_role: {rules: [{value: 'admin', groups: ['github:admins']}]}}

        expect(evaluateClaimMappings(mappings, ['github:staff'])).toEqual({})
        expect(evaluateClaimMappings(mappings, ['github:admins'])).toEqual({immich_role: 'admin'})
    })

    it('never matches a rule without groups, so default is the only catch-all', () => {
        expect(evaluateClaimMappings({role: {rules: [{value: 'everyone', groups: []}]}}, ['a:b']))
            .toEqual({})
    })

    it('tolerates absent, empty and malformed mappings', () => {
        expect(evaluateClaimMappings(undefined, ['a:b'])).toEqual({})
        expect(evaluateClaimMappings({}, ['a:b'])).toEqual({})
        expect(evaluateClaimMappings(immichRole, undefined)).toEqual({immich_role: 'user'})
        expect(evaluateClaimMappings({role: {default: 7}}, [])).toEqual({})
    })

    it('refuses to emit a claim Passmower owns even if one reaches Redis', () => {
        const mappings = {groups: {default: 'nice-try'}, email_verified: {default: 'true'}, immich_role: {default: 'user'}}

        expect(evaluateClaimMappings(mappings, [])).toEqual({immich_role: 'user'})
    })
})

describe('claim mapping validation', () => {
    it('accepts absent mappings and the documented shape', () => {
        expect(validateClaimMappings(undefined)).toEqual([])
        expect(validateClaimMappings({})).toEqual([])
        expect(validateClaimMappings(immichRole)).toEqual([])
        expect(validateClaimMappings({'codemowers.io/roles': {default: 'member'}})).toEqual([])
    })

    it('rejects claims Passmower owns or computes itself', () => {
        for (const claim of ['sub', 'groups', 'email', 'email_verified', 'username', 'applications', 'codemowers.io/namespaces']) {
            expect(validateClaimMappings({[claim]: {default: 'x'}}))
                .toEqual([`claim "${claim}" is reserved by Passmower`])
        }
    })

    it('rejects unusable claim names and rule shapes', () => {
        expect(validateClaimMappings({'has space': {default: 'x'}})).toEqual(
            ['claim "has space" is not a valid claim name'])
        expect(validateClaimMappings({'1role': {default: 'x'}})).toEqual(
            ['claim "1role" is not a valid claim name'])
        expect(validateClaimMappings({role: {rules: [{groups: ['a:b']}]}})).toEqual(
            ['claim "role" rule 0 has a non-string value'])
        expect(validateClaimMappings({role: {rules: [{value: 'x', groups: 'a:b'}]}})).toEqual(
            ['claim "role" rule 0 has a non-list groups'])
        expect(validateClaimMappings({role: {default: 7}})).toEqual(
            ['claim "role" has a non-string default'])
        expect(validateClaimMappings({role: {}})).toEqual(
            ['claim "role" has neither rules nor a default'])
        expect(validateClaimMappings([immichRole])).toEqual(
            ['claimMappings must be an object keyed by claim name'])
    })

    it('reports every problem so one reconcile message covers the resource', () => {
        expect(validateClaimMappings({sub: {default: 'x'}, 'bad name': {default: 'y'}}))
            .toHaveLength(2)
    })
})

// oidc-provider drops any claim it has not been told about (helpers/claims.js
// masks against claimsSupported, built once at boot). Mapped claim names come
// from CRDs at runtime, so registration reaches into the provider's live
// configuration — the one place this codebase depends on an oidc-provider
// internal. If an upgrade changes that shape, this test is the canary: mapped
// claims would otherwise start disappearing from tokens silently.
describe('claim registration against oidc-provider internals', () => {
    const buildProvider = () => new Provider(process.env.ISSUER_URL, {...configuration})

    it('adds unknown claim names to the live provider configuration', () => {
        const provider = buildProvider()
        const {claims, claimsSupported} = instance(provider).configuration

        expect(claimsSupported.has('immich_role')).toBe(false)
        expect(registerMappedClaims(provider, immichRole)).toEqual(['immich_role'])
        // Bound to openid, which every authorization grants — the mask resolves
        // claims per granted scope, so an unbound name would never be emitted.
        expect(claims.openid.immich_role).toBeNull()
        expect(claimsSupported.has('immich_role')).toBe(true)
    })

    it('is idempotent and leaves reserved names alone', () => {
        const provider = buildProvider()

        expect(registerMappedClaims(provider, immichRole)).toEqual(['immich_role'])
        expect(registerMappedClaims(provider, immichRole)).toEqual([])
        expect(registerMappedClaims(provider, {groups: {default: 'x'}})).toEqual([])
        expect(registerMappedClaims(provider, undefined)).toEqual([])
    })

    it('registers and evaluates in one step for the request path', () => {
        const provider = buildProvider()
        const client = {claimMappings: immichRole}

        expect(mappedClaimsFor(provider, client, ['github:admins'])).toEqual({immich_role: 'admin'})
        expect(mappedClaimsFor(provider, client, [])).toEqual({immich_role: 'user'})
        expect(mappedClaimsFor(provider, {}, ['github:admins'])).toEqual({})
        expect(mappedClaimsFor(undefined, client, ['github:admins'])).toEqual({})
    })
})
