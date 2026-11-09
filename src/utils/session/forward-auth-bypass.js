// Unprotected paths of a forward-auth client (#40): requests an application
// must receive without a signed-in user, typically webhooks from other
// systems. A match skips authentication entirely, so matching is strict.

export const MAX_UNPROTECTED_PATHS = 32

const first = (value) => value?.split(',')[0].trim() || undefined

// A path is only compared when what Passmower sees is what the application
// will route: no dot segments, empty segments, backslashes or percent-encoded
// separators that a backend might resolve to somewhere else.
const isPlainPath = (path) =>
    path.startsWith('/')
    && !/\/\/|\\|%2f|%5c|%2e|%00|%25/i.test(path)
    && !path.split('/').some(segment => segment === '.' || segment === '..')

// Usable rules from spec.unprotectedPaths; malformed entries are dropped.
export const unprotectedPathRules = (value) => {
    if (!Array.isArray(value)) return []
    const rules = []
    for (const rule of value.slice(0, MAX_UNPROTECTED_PATHS)) {
        const pathPrefix = rule?.pathPrefix
        if (typeof pathPrefix !== 'string' || !isPlainPath(pathPrefix)) continue
        const methods = Array.isArray(rule.methods)
            ? rule.methods.filter(m => typeof m === 'string').map(m => m.toUpperCase())
            : []
        rules.push({pathPrefix, methods})
    }
    return rules
}

// A prefix matches whole path segments: /hooks covers /hooks and /hooks/x,
// never /hooks-admin.
const matchesPrefix = (path, prefix) =>
    path === prefix || path.startsWith(prefix.endsWith('/') ? prefix : `${prefix}/`)

// True when the proxied request, as described by the X-Forwarded-* headers of
// the forward-auth subrequest, falls under one of the client's rules.
export const isUnprotectedRequest = (client, headers) => {
    const rules = unprotectedPathRules(client?.unprotectedPaths)
    if (!rules.length) return false
    const path = (headers['x-forwarded-uri'] || '/').split('?')[0]
    if (!isPlainPath(path)) return false
    // A proxy that does not say which method it is forwarding cannot satisfy
    // a rule limited to some methods.
    const method = first(headers['x-forwarded-method'])?.toUpperCase()
    return rules.some(rule =>
        matchesPrefix(path, rule.pathPrefix) && (!rule.methods.length || rule.methods.includes(method)))
}
