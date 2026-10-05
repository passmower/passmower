// Which RFC 8707 resources a client may obtain access tokens for.
//
// Passmower mints a JWT audience-bound to whatever resource a client names, so
// without a check any client could obtain tokens accepted by any resource
// server that trusts this issuer, for every user who signs in to it. A client's
// `allowedResources` lists the resources it may name. A client without the
// field keeps the historical behaviour (any resource) unless the deployment
// sets RESOURCE_ALLOWLIST_REQUIRED, in which case it may name none.

export function allowlistRequired(env = process.env) {
    return env.RESOURCE_ALLOWLIST_REQUIRED === 'true'
}

export function isResourceAllowed(client, resource, required = allowlistRequired()) {
    const allowed = client?.allowedResources
    if (Array.isArray(allowed)) {
        return allowed.includes(resource)
    }
    return !required
}

// A resource indicator is an absolute URI without a fragment (RFC 8707 §2).
export function isResourceIndicator(value) {
    if (typeof value !== 'string') {
        return false
    }
    try {
        const url = new URL(value)
        return (url.protocol === 'https:' || url.protocol === 'http:') && url.hash === '' && !value.includes('#')
    } catch {
        return false
    }
}
