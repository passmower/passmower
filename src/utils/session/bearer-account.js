import * as jose from "jose";
import Account from "../../models/account.js";

// Resource-bound (RFC 8707) access tokens use the self-contained JWT format
// and are never persisted, so provider.AccessToken.find() cannot resolve
// them. Verify those against our own signing keys and use the embedded
// claims instead.
let localJwksPromise;
const getLocalJwks = () => {
    if (!localJwksPromise) {
        localJwksPromise = (async () => {
            // OIDC_JWKS holds a bare key array (see configuration.js jwks). The keys
            // usually carry no kid; oidc-provider signs with the RFC 7638 thumbprint
            // as the kid, so stamp the same onto the public JWKs or lookup fails.
            const keys = JSON.parse(process.env.OIDC_JWKS)
            const publicKeys = await Promise.all(keys.map(async ({d, p, q, dp, dq, qi, ...publicJwk}) => ({
                ...publicJwk,
                kid: publicJwk.kid ?? await jose.calculateJwkThumbprint(publicJwk),
            })))
            return jose.createLocalJWKSet({keys: publicKeys})
        })()
        localJwksPromise.catch(() => { localJwksPromise = null })
    }
    return localJwksPromise
}

const findJwtAccessToken = async (token) => {
    try {
        const {payload} = await jose.jwtVerify(token, await getLocalJwks(), {
            issuer: process.env.ISSUER_URL,
            typ: 'at+jwt',
        })
        return {accountId: payload.sub, scope: payload.scope}
    } catch (error) {
        // Expected for garbage/expired tokens, but also surfaces config errors
        // (key set, issuer) that would otherwise be a silent 401.
        globalThis.logger?.warn({error: String(error)}, 'bearer JWT verification failed')
        return null
    }
}

// Resolves the Account behind a Bearer access token, enforcing an optional required scope.
// Returns { account, scopes } on success, or { status } carrying an HTTP error code.
export const accountFromBearer = async (ctx, provider, requiredScope = null) => {
    const header = ctx.headers.authorization || ''
    const [scheme, token] = header.split(' ')
    if (scheme !== 'Bearer' || !token) {
        return {status: 401}
    }
    const accessToken = await provider.AccessToken.find(token) ?? await findJwtAccessToken(token)
    if (!accessToken) {
        return {status: 401}
    }
    const scopes = new Set((accessToken.scope || '').split(' ').filter(Boolean))
    if (requiredScope && !scopes.has(requiredScope)) {
        return {status: 403}
    }
    const account = await Account.findAccount(ctx, accessToken.accountId)
    if (!account) {
        return {status: 401}
    }
    return {account, scopes}
}
