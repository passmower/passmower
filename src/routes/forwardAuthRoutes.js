import Router from "koa-router";
import {enableAndGetRedirectUri} from "../support/self-oidc-client.js";
import originalUrl from 'original-url';
import {validateSiteSession} from "../support/site-session.js";
import Account from "../support/account.js";
import {isHostInProviderBaseDomain} from "../support/base-domain.js";

export default (provider) => {
    const router = new Router();

    router.get('/forward-auth', async (ctx) => {
        ctx.status = 401
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

        const cookie = await validateSiteSession(ctx, provider)
        if (cookie) {
            const account = await Account.findAccount(ctx, cookie.accountId)
            if (account) {
                Object.keys(account.getRemoteHeaders()).map(k => {
                    ctx.set(k, account.getRemoteHeaders()[k])
                })
                ctx.status = 200
            }
        } else {
            const url = await enableAndGetRedirectUri(provider, originalUri.full.replace(originalUri.pathname, ''))
            return ctx.redirect(url)
        }
    });

    return router
}
