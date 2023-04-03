/* eslint-disable no-console, camelcase, no-unused-vars */
import { koaBody as bodyParser } from 'koa-body';
import Router from 'koa-router';
import Account from '../support/account.js';
import RedisAdapter from "../adapters/redis.js";
import {UAParser} from "ua-parser-js";

export default (provider) => {
    const router = new Router();

    router.use(bodyParser({ json: true }))

    router.get('/api/me', async (ctx, next) => {
        const session = await provider.Session.get(ctx)
        const signedIn = !!session.accountId
        if (signedIn) {
            const account = await Account.findAccount(ctx, session.accountId)
            ctx.body = {
                emails: account.emails,
                name: account.profile.name,
                company: account.profile.company
            }
        }
    })

    router.post('/api/me', async (ctx, next) => {
        const session = await provider.Session.get(ctx)
        const signedIn = !!session.accountId
        if (signedIn) {
            const account = await Account.updateProfile(ctx, session.accountId, ctx.request.body)
            ctx.body = {
                emails: account.emails,
                name: account.profile.name,
                company: account.profile.company
            }
        }
    })

    router.get('/api/sessions', async (ctx, next) => {
        const session = await provider.Session.get(ctx)
        const signedIn = !!session.accountId
        if (signedIn) {
            const redis = new RedisAdapter('AccountSession')
            const metadataRedis = new RedisAdapter('SessionMetadata')
            let sessions = await redis.getSet(session.accountId)
            sessions = await Promise.all(
                sessions.map(async (s) => {
                    const metadata = await metadataRedis.find(s)
                    if (metadata !== undefined) {
                        const ua = UAParser(metadata).withClientHints()
                        return {
                            id: s,
                            ua,
                            ip: metadata['x-forwarded-for'],
                            browser: ua.browser.name,
                            os: ua.os.name + ' ' + ua.os.version,
                            current: s === session.id,
                            created_at: new Date(metadata.iat * 1000),
                        }
                    }
                })
            )
            sessions = sessions.filter(item => item);
            ctx.body = {
                sessions
            }
        }
    })

    router.post('/api/session/end', async (ctx, next) => {
        const currentSession = await provider.Session.get(ctx)
        const signedIn = !!currentSession.accountId
        if (signedIn) {
            let sessionToDelete = ctx.request.body.id
            const accountSessionRedis = new RedisAdapter('AccountSession')
            const metadataRedis = new RedisAdapter('SessionMetadata')
            let sessions = await accountSessionRedis.getSet(currentSession.accountId)
            sessionToDelete = sessions.filter((s) => {return s === currentSession.jti}).find((s) => {
                return s === sessionToDelete
            })
            if (sessionToDelete !== undefined) {
                const sessionRedis = new RedisAdapter('Sessions')
                await sessionRedis.destroy(sessionToDelete)
                await accountSessionRedis.remove(currentSession.accountId, sessionToDelete)
                sessions = sessions.filter((s) => {return s === sessionToDelete})
                // TODO: back channel logout etc.
            }
            sessions = await Promise.all(
                sessions.map(async (s) => {
                    const metadata = await metadataRedis.find(s)
                    if (metadata !== undefined) {
                        const ua = UAParser(metadata).withClientHints()
                        return {
                            id: s,
                            ua,
                            ip: metadata['x-forwarded-for'],
                            browser: ua.browser.name,
                            os: ua.os.name + ' ' + ua.os.version,
                            current: s === currentSession.id,
                            created_at: new Date(metadata.iat * 1000),
                        }
                    }
                })
            )
            sessions = sessions.filter(item => item);
            ctx.body = {
                sessions
            }
        }
    })

    return router;
};
