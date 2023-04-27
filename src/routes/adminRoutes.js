import Router from "koa-router";
import {SessionService} from "../implementation/session-service.js";
import {koaBody as bodyParser} from "koa-body";
import Account from "../support/account.js";

export default (provider) => {
    const router = new Router();
    const sessionService = new SessionService();

    router.use(bodyParser({ json: true }))
    router.use(async (ctx, next) => {
        let session = await sessionService.getAdminSession(ctx)
        if (session) {
            ctx.adminSession = session
            return next()
        } else {
            const session = await provider.Session.get(ctx)
            const signedIn = !!session.accountId
            if (signedIn) {
                ctx.currentSession = session
                const account = await Account.findAccount(ctx, session.accountId)
                if (account.isAdmin) {
                    ctx.adminSession = session
                    await sessionService.setAdminSession(ctx, session)
                    return next()
                }
            }
        }
    })

    router.get('/admin', async (ctx, next) => {
        return ctx.render('adminpage', { layout: false, title: 'oidc-gateway' })
    })

    router.get('/admin/api/accounts', async (ctx, next) => {
        let accounts = await ctx.kubeApiService.listUsers()
        ctx.body = {
            accounts: accounts.map((acc) => acc.getProfileResponse(true))
        }
    })

    router.get('/admin/api/account/impersonation', async (ctx, next) => {
        ctx.body = {
            impersonation: await sessionService.getImpersonation(ctx)
        }
    })

    router.post('/admin/api/account/impersonation', async (ctx, next) => {
        const accountId = ctx.request.body.accountId
        const impersonation = await sessionService.impersonate(ctx, accountId)
        ctx.body = {
            impersonation
        }
    })

    router.post('/admin/api/account/impersonation/end', async (ctx, next) => {
        await sessionService.endImpersonation(ctx)
        ctx.body = {
            impersonation: null
        }
    })

    return router
}
