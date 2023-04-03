/* eslint-disable no-console, camelcase, no-unused-vars */
import { koaBody as bodyParser } from 'koa-body';
import Router from 'koa-router';
import Account from '../support/account.js';
import {SessionService} from "../implementation/session-service.js";

export default (provider) => {
    const router = new Router();
    const sessionService = new SessionService();

    router.use(bodyParser({ json: true }))
    router.use(async (ctx, next) => {
        const session = await provider.Session.get(ctx)
        const signedIn = !!session.accountId
        if (signedIn) {
            ctx.currentSession = session
            return next()
        }
    })

    router.get('/api/me', async (ctx, next) => {
        const account = await Account.findAccount(ctx, ctx.currentSession.accountId)
        ctx.body = {
            emails: account.emails,
            name: account.profile.name,
            company: account.profile.company
        }
    })

    router.post('/api/me', async (ctx, next) => {
        const account = await Account.updateProfile(ctx, ctx.currentSession.accountId, ctx.request.body)
        ctx.body = {
            emails: account.emails,
            name: account.profile.name,
            company: account.profile.company
        }
    })

    router.get('/api/sessions', async (ctx, next) => {
        let sessions = await sessionService.getSessions(ctx.currentSession.accountId, ctx.currentSession)
        ctx.body = {
            sessions
        }
    })

    router.post('/api/session/end', async (ctx, next) => {
        const sessionToDelete = ctx.request.body.id
        const sessions = await sessionService.endSession(sessionToDelete, ctx.currentSession, provider)
        ctx.body = {
            sessions
        }
    })

    return router;
};
