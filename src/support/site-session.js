import RedisAdapter from "../adapters/redis.js";
import instance from "oidc-provider/lib/helpers/weak_cache.js";
import nanoid from "oidc-provider/lib/helpers/nanoid.js";
import {providerBaseDomain} from "./base-domain.js";

export const addSiteSession = async (ctx, provider) => {
    const redis = new RedisAdapter('SiteSession')
    const siteWideCookie = nanoid()
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
    await redis.upsert(siteWideCookie, {
        jti: siteWideCookie,
        sessionId: ctx?.oidc?.entities?.Session?.jti,
        accountId: ctx?.oidc?.entities?.Session?.accountId,
        domain,
    }, instance(provider).configuration('ttl.SiteSession'));
}

export const validateSiteSession = async (ctx, provider) => {
    const sessionRedis = new RedisAdapter('Session')
    const siteSessionRedis = new RedisAdapter('SiteSession')
    let cookie = ctx.cookies.get(provider.cookieName('site_session'))
    cookie = await siteSessionRedis.find(cookie)
    const baseSession = await sessionRedis.find(cookie?.sessionId)
    return (baseSession && cookie.domain === providerBaseDomain) ? cookie : undefined
}
