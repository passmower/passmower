import RedisAdapter from "../adapters/redis.js";
import instance from "oidc-provider/lib/helpers/weak_cache.js";
import nanoid from "oidc-provider/lib/helpers/nanoid.js";
import {providerBaseDomain} from "./base-domain.js";
import configuration from "./configuration.js";

export const addSiteSession = async (ctx, provider, sessionId, accountId) => {
    const redis = new RedisAdapter('SiteSession')
    let siteWideCookie = nanoid()
    const domain = providerBaseDomain
    ctx.cookies.set(
        provider.cookieName('site_session'),
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

export const validateSiteSession = async (ctx) => {
    const sessionRedis = new RedisAdapter('Session')
    const siteSessionRedis = new RedisAdapter('SiteSession')
    let siteSession = ctx.cookies.get(configuration.cookies.names['site_session'])
    siteSession = await siteSessionRedis.find(siteSession)
    const baseSession = siteSession?.sessionId ? await sessionRedis.find(siteSession?.sessionId) : true // Handle situation when siteSession does not yet have sessionId
    return (baseSession && siteSession?.domain === providerBaseDomain) ? siteSession : undefined
}
