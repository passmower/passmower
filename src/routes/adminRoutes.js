import Router from "koa-router";
import {koaBody as bodyParser} from "koa-body";
import Account, {GroupPrefix} from "../support/account.js";
import {GitHubGroupPrefix} from "../support/kube-constants.js";
import {signedInToSelf} from "../support/signed-in.js";
import {auditLog} from "../support/audit-log.js";
import validator, {
    checkAccountId, checkCompanyName,
    checkEmail, checkIfEmailIsTaken,
    checkRealName,
    checkUsername,
    restValidationErrors
} from "../support/validator.js";
import {UsernameCommitted} from "../support/conditions/username-committed.js";

export default (provider) => {
    const router = new Router();
    router.use(bodyParser({ json: true }))
    router.use(validator)
    router.use(async (ctx, next) => {
        let session = await ctx.sessionService.getAdminSession(ctx)
        if (session) {
            ctx.adminSession = session
            return next()
        } else {
            const session = await signedInToSelf(ctx, provider)
            if (session) {
                if (ctx.currentAccount.isAdmin) {
                    ctx.adminSession = session
                    await ctx.sessionService.setAdminSession(ctx, session)
                    auditLog(ctx, {}, 'Admin session granted')
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
            groupPrefix: GroupPrefix,
            requireUsername: process.env.REQUIRE_CUSTOM_USERNAME === 'true',
        }
    })

    router.get('/admin/api/accounts', async (ctx, next) => {
        let accounts = await ctx.kubeOIDCUserService.listUsers()
        ctx.body = {
            accounts: accounts.map((acc) => acc.getProfileResponse(true, ctx.adminSession.accountId))
        }
    })

    router.post('/admin/api/accounts', async (ctx, next) => {
        checkAccountId(ctx)
        checkRealName(ctx)
        checkCompanyName(ctx)
        if (await restValidationErrors(ctx)) {
            return
        }
        const accountId = ctx.request.body.accountId
        const body = {
                name: ctx.request.body.name,
                company: ctx.request.body.company,
                groups: ctx.request.body.groups,
        }
        await ctx.kubeOIDCUserService.updateUserSpec({
            accountId,
            customProfile: body,
            customGroups: body.groups.filter(g => g.name).filter(g => g.prefix !== GitHubGroupPrefix)
                .filter((val, index, self) => {return self.findIndex((g) => {return g.name === val.name && g.prefix === val.prefix}) === index}),
        })
        auditLog(ctx, {accountId, body}, 'Admin updated user')
        let accounts = await ctx.kubeOIDCUserService.listUsers()
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
        checkAccountId(ctx)
        if (await restValidationErrors(ctx)) {
            return
        }
        const accountId = ctx.request.body.accountId
        const impersonation = await ctx.sessionService.impersonate(ctx, accountId)
        auditLog(ctx, {accountId}, 'Admin enabled impersonation')
        ctx.body = {
            impersonation
        }
    })

    router.post('/admin/api/account/impersonation/end', async (ctx, next) => {
        await ctx.sessionService.endImpersonation(ctx)
        auditLog(ctx, {}, 'Admin ended impersonation')
        ctx.body = {
            impersonation: null
        }
    })

    router.post('/admin/api/account/approve', async (ctx, next) => {
        checkAccountId(ctx)
        if (await restValidationErrors(ctx)) {
            return
        }
        const accountId = ctx.request.body.accountId
        await Account.approve(ctx, accountId)
        auditLog(ctx, {accountId}, 'Admin approved user')
        let accounts = await ctx.kubeOIDCUserService.listUsers()
        ctx.body = {
            accounts: accounts.map((acc) => acc.getProfileResponse(true))
        }
    })

    router.post('/admin/api/account/invite', async (ctx, next) => {
        const email = ctx.request.body.email
        let username = ctx.request.body.username

        if (process.env.REQUIRE_CUSTOM_USERNAME === 'true') {
            checkUsername(ctx)
        } else {
            username = Account.getUid()
        }
        checkEmail(ctx)
        checkIfEmailIsTaken(ctx)
        if (await restValidationErrors(ctx)) {
            return
        }

        const account = await Account.createOrUpdateByEmails(ctx, provider, email, undefined, username);
        let condition = new UsernameCommitted()
        condition = condition.setStatus(true)
        account.addCondition(condition)
        await ctx.kubeOIDCUserService.updateUserStatus(account)
        await Account.approve(ctx, account.accountId)
        auditLog(ctx, {email}, 'Admin invited user')
        let accounts = await ctx.kubeOIDCUserService.listUsers()
        ctx.body = {
            accounts: accounts.map((acc) => acc.getProfileResponse(true))
        }
    })

    return router
}
