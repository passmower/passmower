/* eslint-disable no-console, camelcase, no-unused-vars */
import { koaBody as bodyParser } from 'koa-body';
import Router from 'koa-router';
import Account from '../support/account.js';
import {signedInSession} from "../support/signed-in.js";

export default (provider) => {
    const router = new Router();

    router.use(bodyParser({ json: true }))
    router.use(async (ctx, next) => {
        const session = await signedInSession(ctx, provider)
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

    return router;
};
