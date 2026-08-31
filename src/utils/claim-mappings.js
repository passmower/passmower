import instance from 'oidc-provider/lib/helpers/weak_cache.js'
import {PROTECTED_CLAIMS} from './protected-claims.js'

// Per-client claim mappings (OIDCClient spec.claimMappings): turn a user's
// group membership into a claim of the application's own naming, so an
// application with its own role or entitlement model can be driven from
// Passmower groups — with no application-specific knowledge here, and no code
// change for the next application that wants one (#220).
//
//   claimMappings:
//     app_role:
//       default: viewer
//       rules:
//         - value: admin
//           groups: ['github:admins']
//
// Rules are evaluated in order and the first one with a matching group wins;
// `default` applies when none match, and the claim is omitted entirely when
// there is no match and no default. A rule with no groups never matches —
// `default` is how you express a catch-all.

// Claims Passmower computes itself, on top of the ones it owns outright: a
// mapping may not shadow the apps list or the webhook-supplied namespaces.
const RESERVED_CLAIMS = new Set([...PROTECTED_CLAIMS, 'applications', 'codemowers.io/namespaces'])

// Deliberately narrower than the JWT spec (any string is a legal member name):
// this is the shape claim names actually take — a bare word, a snake_cased one,
// or a domain-prefixed one like codemowers.io/roles — and it keeps mapped names
// printable and unambiguous in discovery metadata.
const CLAIM_NAME = /^[a-zA-Z][a-zA-Z0-9._:/-]{0,63}$/

// Returns human-readable problems for the operator to surface on the resource,
// empty when the mappings are usable. The CRD schema covers the types; this
// covers what a schema cannot express.
export const validateClaimMappings = (claimMappings) => {
    if (claimMappings === undefined || claimMappings === null) {
        return []
    }
    if (typeof claimMappings !== 'object' || Array.isArray(claimMappings)) {
        return ['claimMappings must be an object keyed by claim name']
    }
    const problems = []
    for (const [claim, mapping] of Object.entries(claimMappings)) {
        if (RESERVED_CLAIMS.has(claim)) {
            problems.push(`claim "${claim}" is reserved by Passmower`)
            continue
        }
        if (!CLAIM_NAME.test(claim)) {
            problems.push(`claim "${claim}" is not a valid claim name`)
            continue
        }
        const rules = mapping?.rules ?? []
        if (!Array.isArray(rules)) {
            problems.push(`claim "${claim}" has a non-list rules`)
            continue
        }
        if (mapping?.default !== undefined && typeof mapping.default !== 'string') {
            problems.push(`claim "${claim}" has a non-string default`)
        }
        rules.forEach((rule, index) => {
            if (typeof rule?.value !== 'string') {
                problems.push(`claim "${claim}" rule ${index} has a non-string value`)
            }
            if (rule?.groups !== undefined && !Array.isArray(rule.groups)) {
                problems.push(`claim "${claim}" rule ${index} has a non-list groups`)
            }
        })
        if (!rules.length && mapping?.default === undefined) {
            problems.push(`claim "${claim}" has neither rules nor a default`)
        }
    }
    return problems
}

// `groups` are the prefixed strings the groups claim carries ("github:admins"),
// which is also how allowedGroups is written — so a mapping and an access rule
// name a group the same way.
export const evaluateClaimMappings = (claimMappings, groups = []) => {
    const memberships = new Set(groups)
    const claims = {}
    for (const [claim, mapping] of Object.entries(claimMappings ?? {})) {
        // Defence in depth: the operator refuses to reconcile a client whose
        // mappings name a reserved claim, so this only fires if one reaches
        // Redis another way.
        if (RESERVED_CLAIMS.has(claim)) {
            continue
        }
        const matched = (mapping?.rules ?? []).find(
            rule => (rule?.groups ?? []).some(group => memberships.has(group))
        )
        const value = matched?.value ?? mapping?.default
        if (typeof value === 'string') {
            claims[claim] = value
        }
    }
    return claims
}

// oidc-provider masks account claims down to the names declared in its `claims`
// configuration, resolved into `claimsSupported` once at boot
// (helpers/claims.js, helpers/configuration.js collectClaims) — a claim it has
// never heard of is dropped silently. Mapped names arrive at runtime from CRDs,
// so they have to be added to that live configuration.
//
// Bound to the `openid` scope: it is granted on every authorization, and an
// application reading a role claim generally does not request a scope for it.
// Registration is additive and global, but values are only ever produced for
// the client being served, so no client sees another client's mapped claims.
// The cost is that mapped names appear in the discovery document's
// claims_supported, which is also the honest answer to what this issuer emits.
export const registerMappedClaims = (provider, claimMappings) => {
    const names = Object.keys(claimMappings ?? {}).filter(claim => !RESERVED_CLAIMS.has(claim))
    if (!names.length) {
        return []
    }
    const {claims, claimsSupported} = instance(provider).configuration
    const registered = names.filter(claim => !claimsSupported.has(claim))
    for (const claim of registered) {
        claims.openid[claim] = null
        claimsSupported.add(claim)
    }
    return registered
}

// Register, then evaluate. Registering here rather than at reconcile time means
// the claim survives the mask on the very first request for a client, whichever
// way that client reached Redis and whether or not the operator has seen it
// since the process started. Both are idempotent.
export const mappedClaimsFor = (provider, client, groups) => {
    const claimMappings = client?.claimMappings
    if (!provider || !claimMappings || !Object.keys(claimMappings).length) {
        return {}
    }
    registerMappedClaims(provider, claimMappings)
    return evaluateClaimMappings(claimMappings, groups)
}
