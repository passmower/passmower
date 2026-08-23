import RedisAdapter from "../../adapters/redis.js";
import instance from "oidc-provider/lib/helpers/weak_cache.js";
import nanoid from "oidc-provider/lib/helpers/nanoid.js";
import {providerBaseDomain} from "./base-domain.js";
import configuration from "../../configuration.js";
import {clientId as selfClientId} from "./self-oidc-client.js";
import {requestIp} from "./parse-request-headers.js";
import {auditLog} from "./audit-log.js";

const providerHostname = new URL(process.env.ISSUER_URL).hostname

const getFullSiteSessionCookieName = (clientId) => {
    return configuration.cookies.names['site_session'] + '.' + clientId
}

export const getSiteSessionCookieDomain = (clientId) => {
    return clientId === selfClientId ? undefined : providerBaseDomain
}

export const getLegacySiteSessionCookieDomain = (clientId) => {
    return clientId === selfClientId && providerBaseDomain !== providerHostname ? providerBaseDomain : undefined
}

// Redis records carry the scope where their cookie is valid: the exact issuer
// host for the dashboard and the shared base domain for forward-auth clients.
const getSiteSessionScope = (clientId) => {
    return getSiteSessionCookieDomain(clientId) ?? providerHostname
}

export const addSiteSession = async (ctx, provider, sessionId, accountId, client) => {
    const redis = new RedisAdapter('SiteSession')
    let siteWideCookie = nanoid()
    const domain = getSiteSessionCookieDomain(client.clientId)
    const cookieOptions = {
        ...instance(provider).configuration.cookies.long,
        maxAge: instance(provider).configuration.ttl.SiteSession * 1000,
    }
    const cookieName = getFullSiteSessionCookieName(client.clientId)
    const legacyDomain = getLegacySiteSessionCookieDomain(client.clientId)
    if (legacyDomain) {
        ctx.cookies.set(cookieName, null, {
            ...instance(provider).configuration.cookies.long,
            domain: legacyDomain,
        })
    }
    if (domain) {
        cookieOptions.domain = domain
    }
    ctx.cookies.set(
        cookieName,
        siteWideCookie,
        cookieOptions
    )
    siteWideCookie = {
        jti: siteWideCookie,
        sessionId,
        accountId,
        domain: getSiteSessionScope(client.clientId),
        ip: requestIp(ctx),
    }
    await redis.upsert(siteWideCookie.jti, siteWideCookie, instance(provider).configuration.ttl.SiteSession);
    return siteWideCookie
}

export const updateSiteSession = async (siteSession) => {
    const siteSessionRedis = new RedisAdapter('SiteSession')
    await siteSessionRedis.upsert(siteSession.jti, siteSession, configuration.ttl.SiteSession)
}

// Opt-in binding of the site session to the requesting client address (#21).
// Records created before the flag was enabled carry no ip and fail closed the
// same way: one fresh authentication rebinds them.
export const siteSessionIpMismatch = (siteSession, ip, env = process.env) => {
    if (env.SITE_SESSION_IP_BINDING !== 'true') return false
    return siteSession?.ip !== ip
}

export const validateSiteSession = async (ctx, clientId) => {
    const sessionRedis = new RedisAdapter('Session')
    const siteSessionRedis = new RedisAdapter('SiteSession')
    let siteSession = ctx.cookies.get(getFullSiteSessionCookieName(clientId))
    siteSession = await siteSessionRedis.find(siteSession)
    if (siteSession && siteSessionIpMismatch(siteSession, requestIp(ctx))) {
        auditLog(ctx, {accountId: siteSession.accountId, clientId},
            'Site session rejected and destroyed: requesting address differs from the issuing address')
        await siteSessionRedis.destroy(siteSession.jti)
        return undefined
    }
    let baseSession = siteSession?.sessionId ? await sessionRedis.find(siteSession?.sessionId) : true // Handle situation when siteSession does not yet have sessionId
    if (baseSession?.authorizations) {
        baseSession = baseSession?.authorizations?.[clientId]
    }
    return (baseSession && siteSession?.domain === getSiteSessionScope(clientId)) ? siteSession : undefined
}

export const updateSessionReference = async (sessionId, oldSessionId, accountId) => {
    const siteSessionRedis = new RedisAdapter('SiteSession')
    const accountSiteSessionRedis = new RedisAdapter('AccountSiteSession')
    const accountSiteSessions = await accountSiteSessionRedis.getSetMembers(accountId)
    if (!accountSiteSessions) {
        return
    }
    await Promise.all(accountSiteSessions.map(async s => {
        const siteSession = await siteSessionRedis.find(s)
        if (siteSession?.sessionId === oldSessionId) {
            await siteSessionRedis.upsert(s, {
                ...siteSession,
                sessionId
            })
        }
    }))
}
