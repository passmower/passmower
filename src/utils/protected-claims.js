// Claims whose values Passmower owns: identity, authorization and token shape.
// Every mechanism that lets configuration outside the provider contribute
// claims — the enrichment webhook (EXTRA_CLAIMS_WEBHOOK_URL) and per-client
// claim mappings (OIDCClient spec.claimMappings) — filters against this list,
// so a compromised webhook or a careless client cannot override
// sub/groups/email_verified and impersonate a user.
export const PROTECTED_CLAIMS = new Set([
    'sub', 'iss', 'aud', 'exp', 'iat', 'nbf', 'jti', 'auth_time', 'nonce',
    'sid', 'azp', 'at_hash', 'c_hash', 'scope', 'client_id',
    'email', 'email_verified', 'emails', 'groups', 'username', 'name',
])
