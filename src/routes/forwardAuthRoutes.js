import Router from "koa-router";
import originalUrl from 'original-url';
import {validateSiteSession} from "../support/site-session.js";
import Account from "../support/account.js";
import {isHostInProviderBaseDomain} from "../support/base-domain.js";
import RedisAdapter from "../adapters/redis.js";
import {enableAndGetRedirectUri} from "../support/enable-and-get-redirect-uri.js";
import {responseType, scope} from "../support/oidc-middleware-client.js";

export default (provider) => {
    const router = new Router();

    router.get('/forward-auth', async (ctx) => {
        ctx.status = 401
        const clientId = ctx.query.client
        if (!clientId) {
            ctx.body = 'client parameter in authentication url is missing'
            return
        }

        const redisAdapter = new RedisAdapter('Client')
        const client = await redisAdapter.find(clientId)
        if (!client) {
            ctx.body = 'unknown client'
            return
        }

        const host = ctx.req.headers['x-forwarded-host']
        if (!host) {
            ctx.body = 'x-forwarded-host header not set'
            return
        }

        const originalUri = originalUrl(ctx.req)
        if (!originalUri.full) {
            ctx.body = 'Unable to determine URL from proxy headers'
            return
        }

        if (!isHostInProviderBaseDomain(originalUri.hostname)) {
            ctx.body = 'Endpoint URL not in the same base domain'
            return
        }

        const cookie = await validateSiteSession(ctx, clientId)
        if (cookie) {
            if (cookie?.result?.error) {
                ctx.body = cookie.result.error
            } else {
                const account = await Account.findAccount(ctx, cookie.accountId)
                if (account) {
                    const remoteHeaders = account.getRemoteHeaders(client.headerMapping)
                    Object.keys(remoteHeaders).map(k => {
                        ctx.set(k, remoteHeaders[k])
                    })
                    ctx.status = 200
                }
            }
        } else {
            const uri =  originalUri.full.replace(originalUri.pathname, '').replace(originalUri.search, '')
            const url = await enableAndGetRedirectUri(provider, uri, clientId, responseType, scope, client)
            return ctx.redirect(url)
        }
    });

    return router
}
