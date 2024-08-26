/* eslint-disable no-console, camelcase, no-unused-vars */
import { koaBody as bodyParser } from 'koa-body';
import Router from 'koa-router';
import {signedInToSelf} from "../utils/session/signed-in.js";
import RedisAdapter from "../adapters/redis.js";
import {checkAccountGroups} from "../utils/user/check-account-groups.js";
import {auditLog} from "../utils/session/audit-log.js";
import validator, {
    checkCompanyName, checkDisableFrontendEdit,
    checkRealName,
    restValidationErrors
} from "../utils/session/validator.js";
import {getText} from "../utils/get-text.js";

export default (provider) => {
    const router = new Router();

    router.use(bodyParser({ json: true }))
    router.use(validator)
    router.use(async (ctx, next) => {
        const session = await signedInToSelf(ctx, provider)
        if (session) {
            return next()
        }
    })

    router.get('/api/me', async (ctx, next) => {
        const account = ctx.currentAccount
        ctx.body = {
            ...account.getProfileResponse(),
            disableEditing: process.env.DISABLE_FRONTEND_EDIT === 'true',
        }
    })

    router.get('/api/texts/disable_frontend_edit', async (ctx, next) => {
        ctx.body = getText('disable_frontend_edit')
    })

    router.post('/api/me', async (ctx, next) => {
        checkRealName(ctx)
        checkCompanyName(ctx)
        checkDisableFrontendEdit(ctx)
        if (await restValidationErrors(ctx)) {
            return
        }

        const accountId = ctx.currentSession.accountId
        const body = ctx.request.body
        const account = await ctx.kubeOIDCUserService.updateUserSpecs(
            accountId,
            {
            passmower: {
                name: body.name,
                company: body.company,
            }
        })
        auditLog(ctx, {accountId, body}, 'User updated profile')
        ctx.body = account.getProfileResponse()
    })

    router.get('/api/sessions', async (ctx, next) => {
        let sessions = await ctx.sessionService.getSessions(ctx.currentSession.accountId, ctx.currentSession)
        ctx.body = {
            sessions
        }
    })

    router.post('/api/session/end', async (ctx, next) => {
        // TODO: maybe validate but security is provided by sessionService anyway.
        const sessionToDelete = ctx.request.body.id
        const sessions = await ctx.sessionService.endSession(sessionToDelete, ctx, next, provider)
        auditLog(ctx, {sessionToDelete}, 'User ended session')
        ctx.body = {
            sessions
        }
        if (ctx.currentSession.jti === sessionToDelete) {
            ctx.redirect('/')
        }
    })

    router.get('/api/apps', async (ctx, next) => {
        const clientsRedis = new RedisAdapter('Clients')
        const clientRedis = new RedisAdapter('Client')
        let apps = await clientsRedis.getSetMembers(1)
        apps = await Promise.all(apps.map(app => {
            return clientRedis.find(app)
        })).then(r => r.filter(c => c?.uri))
            .then(r => r.filter(c => checkAccountGroups(c, ctx.currentAccount)))
        apps = await Promise.all(apps.map(async c => {
            return {
                name: c.displayName ?? c.client_name,
                url: c.uri,
                metadata: await ctx.sessionService.getLastSessionInfoPerClient(ctx.currentSession.accountId, c.client_id)
            }
        })).then(apps => apps.sort((a, b) => a.name.localeCompare(b.name)))
        ctx.body = {
            apps
        }
    })

    return router;
};
