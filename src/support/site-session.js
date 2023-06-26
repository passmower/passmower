import RedisAdapter from "../adapters/redis.js";
import instance from "oidc-provider/lib/helpers/weak_cache.js";
import nanoid from "oidc-provider/lib/helpers/nanoid.js";
import {providerBaseDomain} from "./base-domain.js";
import configuration from "./configuration.js";

const getFullSiteSessionCookieName = (clientId) => {
    return configuration.cookies.names['site_session'] + '.' + clientId
}

export const addSiteSession = async (ctx, provider, sessionId, accountId, client) => {
    const redis = new RedisAdapter('SiteSession')
    let siteWideCookie = nanoid()
    const domain = providerBaseDomain
    ctx.cookies.set(
        getFullSiteSessionCookieName(client.clientId),
        siteWideCookie,
        {
            ...instance(provider).configuration('cookies.long'),
            domain,
            maxAge: instance(provider).configuration('ttl.SiteSession') * 1000,
        }
    )
    siteWideCookie = {
        jti: siteWideCookie,
        sessionId,
        accountId,
        domain,
    }
    await redis.upsert(siteWideCookie.jti, siteWideCookie, instance(provider).configuration('ttl.SiteSession'));
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
    return (baseSession && siteSession?.domain === providerBaseDomain) ? siteSession : undefined
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
