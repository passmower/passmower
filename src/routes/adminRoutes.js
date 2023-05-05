import Router from "koa-router";
import {koaBody as bodyParser} from "koa-body";
import Account from "../support/account.js";
import {GitHubGroupPrefix} from "../support/kube-constants.js";

export default (provider) => {
    const router = new Router();

    router.use(bodyParser({ json: true }))
    router.use(async (ctx, next) => {
        let session = await ctx.sessionService.getAdminSession(ctx)
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
                    await ctx.sessionService.setAdminSession(ctx, session)
                    return next()
                }
            }
        }
    })

    router.get('/admin', async (ctx, next) => {
        return ctx.render('frontend', { layout: false, title: 'oidc-gateway' })
    })

    router.get('/admin/api/metadata', async (ctx, next) => {
        ctx.body = {
            groupPrefix: process.env.GROUP_PREFIX
        }
    })

    router.get('/admin/api/accounts', async (ctx, next) => {
        let accounts = await ctx.kubeApiService.listUsers()
        ctx.body = {
            accounts: accounts.map((acc) => acc.getProfileResponse(true))
        }
    })

    router.post('/admin/api/accounts/:accountId', async (ctx, next) => {
        const accountId = ctx.request.params.accountId
        const body = ctx.request.body
        await ctx.kubeApiService.updateUserSpec({
            accountId,
            customProfile: {
                name: body.name,
                company: body.company,
            },
            customGroups: body.groups.filter(g => g.name).filter(g => g.prefix !== GitHubGroupPrefix)
                .filter((val, index, self) => {return self.findIndex((g) => {return g.name === val.name && g.prefix === val.prefix}) === index}),
        })
        let accounts = await ctx.kubeApiService.listUsers()
        ctx.body = {
            accounts: accounts.map((acc) => acc.getProfileResponse(true))
        }
    })

    router.get('/admin/api/account/impersonation', async (ctx, next) => {
        ctx.body = {
            impersonation: await ctx.sessionService.getImpersonation(ctx)
        }
    })

    router.post('/admin/api/account/impersonation', async (ctx, next) => {
        const accountId = ctx.request.body.accountId
        const impersonation = await ctx.sessionService.impersonate(ctx, accountId)
        ctx.body = {
            impersonation
        }
    })

    router.post('/admin/api/account/impersonation/end', async (ctx, next) => {
        await ctx.sessionService.endImpersonation(ctx)
        ctx.body = {
            impersonation: null
        }
    })

    return router
}
