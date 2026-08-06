import RedisAdapter from "../../adapters/redis.js";
import instance from "oidc-provider/lib/helpers/weak_cache.js";
import nanoid from "oidc-provider/lib/helpers/nanoid.js";
import {providerBaseDomain} from "./base-domain.js";
import configuration from "../../configuration.js";
import {clientId as selfClientId} from "./self-oidc-client.js";

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
    }
    await redis.upsert(siteWideCookie.jti, siteWideCookie, instance(provider).configuration.ttl.SiteSession);
    return siteWideCookie
}

export const updateSiteSession = async (siteSession) => {
    const siteSessionRedis = new RedisAdapter('SiteSession')
    await siteSessionRedis.upsert(siteSession.jti, siteSession, configuration.ttl.SiteSession)
}

export const validateSiteSession = async (ctx, clientId) => {
    const sessionRedis = new RedisAdapter('Session')
    const siteSessionRedis = new RedisAdapter('SiteSession')
    let siteSession = ctx.cookies.get(getFullSiteSessionCookieName(clientId))
    siteSession = await siteSessionRedis.find(siteSession)
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
