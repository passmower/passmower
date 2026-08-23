// Calls a generic, external claims-enrichment webhook (an operator-supplied
// HTTP service, in the spirit of Auth0 Actions or Okta inline hooks) and
// returns the JSON claims object to merge into the issued token. Configured
// via EXTRA_CLAIMS_WEBHOOK_URL; when unset the feature is off and this
// returns {}.
//
// Fail-open by design: a webhook outage or bad response must never block login,
// so any error yields {} (the enriched claim is simply absent) rather than
// throwing. Keep this for small, stable signals only — never a hot-path
// dependency.
// Claims the webhook must never influence: identity, authorization, and
// token-shape claims are owned by Passmower. The webhook's response is merged
// into issued tokens verbatim, so without this filter a compromised or buggy
// webhook could override sub/groups/email_verified and impersonate any user.
const PROTECTED_CLAIMS = new Set([
    'sub', 'iss', 'aud', 'exp', 'iat', 'nbf', 'jti', 'auth_time', 'nonce',
    'sid', 'azp', 'at_hash', 'c_hash', 'scope', 'client_id',
    'email', 'email_verified', 'emails', 'groups', 'username', 'name',
])

const sanitizeClaims = (claims, sub) => {
    const entries = Object.entries(claims)
    const safe = entries.filter(([key]) => !PROTECTED_CLAIMS.has(key))
    if (safe.length !== entries.length) {
        const stripped = entries.filter(([key]) => PROTECTED_CLAIMS.has(key)).map(([key]) => key)
        console.error('Extra claims webhook tried to set protected claims; stripped', { stripped, sub })
    }
    return Object.fromEntries(safe)
}

export async function fetchExtraClaims({ sub, groups, client_id, scope }) {
    const url = process.env.EXTRA_CLAIMS_WEBHOOK_URL
    if (!url) {
        return {}
    }
    const token = process.env.EXTRA_CLAIMS_WEBHOOK_TOKEN
    try {
        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'content-type': 'application/json',
                ...(token ? { authorization: `Bearer ${token}` } : {}),
            },
            body: JSON.stringify({ sub, groups, client_id, scope }),
            signal: AbortSignal.timeout(2000),
        })
        if (!response.ok) {
            console.error('Extra claims webhook returned non-OK status', { status: response.status, sub })
            return {}
        }
        const claims = await response.json()
        return (claims && typeof claims === 'object' && !Array.isArray(claims)) ? sanitizeClaims(claims, sub) : {}
    } catch (error) {
        console.error('Extra claims webhook request failed', { error: error.message, sub })
        return {}
    }
}
