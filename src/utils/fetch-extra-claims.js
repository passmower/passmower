// Calls a generic, external claims-enrichment webhook (e.g. the Codemowers
// platform-manager / billing service) and returns the JSON claims object to
// merge into the issued token. Configured via EXTRA_CLAIMS_WEBHOOK_URL; when
// unset the feature is off and this returns {}.
//
// Fail-open by design: a webhook outage or bad response must never block login,
// so any error yields {} (the enriched claim is simply absent) rather than
// throwing. Keep this for small, stable signals only — never a hot-path
// dependency.
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
        return (claims && typeof claims === 'object') ? claims : {}
    } catch (error) {
        console.error('Extra claims webhook request failed', { error: error.message, sub })
        return {}
    }
}
