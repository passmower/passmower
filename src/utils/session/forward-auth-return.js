import {createHmac, randomUUID, timingSafeEqual} from "crypto";
import instance from "oidc-provider/lib/helpers/weak_cache.js";
import {isHostInProviderBaseDomain} from "./base-domain.js";

// Forward-auth clients authorize against one fixed redirect URI on Passmower
// itself. The page the user asked for travels in the authorization request's
// state, signed with the cookie keys, so tokens are only ever delivered to
// Passmower and request headers never add redirect URIs to a client.
export const forwardAuthReturnPath = '/forward-auth/return'
export const forwardAuthRedirectUri = () => `${process.env.ISSUER_URL}${forwardAuthReturnPath.slice(1)}`

const first = (value) => value?.split(',')[0].trim() || undefined

// WebSocket upgrades reach forward-auth with a ws(s) scheme. They are checked
// like the page they belong to, and a sign-in redirect for one returns to that
// page, since a browser cannot be redirected to a WebSocket URL.
const PAGE_SCHEME = new Map([['http', 'http'], ['https', 'https'], ['ws', 'http'], ['wss', 'https']])

// The URL the proxy was asked for, from the X-Forwarded-* headers Traefik and
// nginx set on forward-auth subrequests. RFC 7239 Forwarded is deliberately
// not consulted. Only http(s) and ws(s) URLs in the provider base domain
// qualify, returned with an http(s) scheme.
export const requestedUrl = (headers) => {
    const proto = PAGE_SCHEME.get(first(headers['x-forwarded-proto'])?.toLowerCase() ?? 'https')
    let host = first(headers['x-forwarded-host'])
    const port = first(headers['x-forwarded-port'])
    const path = headers['x-forwarded-uri'] || '/'
    if (!proto || !host || !path.startsWith('/')) return undefined
    // Proxies that send a port-less host (nginx $host) carry the port separately.
    if (port && !/\]:\d+$|^[^[\]]+:\d+$/.test(host)) host = `${host}:${port}`
    let authority, url
    try {
        authority = new URL(`${proto}://${host}`)
        url = new URL(`${proto}://${host}${path}`)
    } catch {
        return undefined
    }
    // Anything in the host that shifted the authority (userinfo, a path, a
    // second host) shows up as a difference against the host-only parse.
    if (authority.username || authority.pathname !== '/' || authority.search || authority.hash
        || url.host !== authority.host || url.username) {
        return undefined
    }
    return isHostInProviderBaseDomain(url.hostname) ? url : undefined
}

// Signed with the newest cookie key; any current key verifies, so a state
// issued just before a key rotation still completes.
const sign = (payload, key) => createHmac('sha256', key).update(payload).digest('base64url')

export const signReturnState = (provider, url, now = Date.now()) => {
    const {cookies, ttl} = instance(provider).configuration
    const payload = Buffer.from(JSON.stringify({
        u: url.href,
        e: Math.floor(now / 1000) + ttl.Interaction,
        n: randomUUID(),
    })).toString('base64url')
    return `${payload}.${sign(payload, cookies.keys[0])}`
}

// The return URL carried by a state this Passmower signed, or undefined for
// anything forged, expired or malformed. The state names no client: it only
// ever sends the browser to a page in the base domain, and which client the
// user authorized is decided by the authorization request, not the state.
export const verifyReturnState = (provider, state, now = Date.now()) => {
    if (typeof state !== 'string') return undefined
    const [payload, signature] = state.split('.')
    if (!payload || !signature) return undefined
    const given = Buffer.from(signature)
    const signedByCurrentKey = instance(provider).configuration.cookies.keys.some((key) => {
        const expected = Buffer.from(sign(payload, key))
        return expected.length === given.length && timingSafeEqual(expected, given)
    })
    if (!signedByCurrentKey) return undefined
    let data
    try {
        data = JSON.parse(Buffer.from(payload, 'base64url').toString())
    } catch {
        return undefined
    }
    if (!(data?.e > now / 1000)) return undefined
    let url
    try {
        url = new URL(data.u)
    } catch {
        return undefined
    }
    return isHostInProviderBaseDomain(url.hostname) ? url.href : undefined
}
