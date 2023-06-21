/* eslint-disable no-console, camelcase, no-unused-vars */
import { koaBody as bodyParser } from 'koa-body';
import Router from 'koa-router';
import {signedInToSelf} from "../support/signed-in.js";
import RedisAdapter from "../adapters/redis.js";
import {checkAccountGroups} from "../support/check-account-groups.js";

export default (provider) => {
    const router = new Router();

    router.use(bodyParser({ json: true }))
    router.use(async (ctx, next) => {
        const session = await signedInToSelf(ctx, provider)
        if (session) {
            return next()
        }
    })

    router.get('/api/me', async (ctx, next) => {
        const account = ctx.currentAccount
        ctx.body = account.getProfileResponse()
    })

    router.post('/api/me', async (ctx, next) => {
        const account = await ctx.kubeOIDCUserService.updateUserSpec({
            accountId: ctx.currentSession.accountId,
            customProfile: ctx.request.body
        })
        ctx.body = account.getProfileResponse()
    })

    router.get('/api/sessions', async (ctx, next) => {
        let sessions = await ctx.sessionService.getSessions(ctx.currentSession.accountId, ctx.currentSession)
        ctx.body = {
            sessions
        }
    })

    router.post('/api/session/end', async (ctx, next) => {
        const sessionToDelete = ctx.request.body.id
        const sessions = await ctx.sessionService.endSession(sessionToDelete, ctx, next, provider)
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
        })).then(r => r.filter(c => c.uri))
            .then(r => r.filter(c => checkAccountGroups(c, ctx.currentAccount)))
        apps = await Promise.all(apps.map(async c => {
            return {
                name: c.displayName ?? c.client_name,
                url: c.uri,
                metadata: await ctx.sessionService.getLastSessionInfoPerClient(ctx.currentSession.accountId, c.client_id)
            }
        }))
        ctx.body = {
            apps
        }
    })

    return router;
};
