/* eslint-disable no-console, camelcase, no-unused-vars */
import { strict as assert } from 'node:assert';
import * as querystring from 'node:querystring';
import { inspect } from 'node:util';

import isEmpty from 'lodash/isEmpty.js';
import { koaBody as bodyParser } from 'koa-body';
import Router from 'koa-router';

import { defaults } from 'oidc-provider/lib/helpers/defaults.js'; // make your own, you'll need it anyway
import Account from '../support/account.js';
import { errors } from 'oidc-provider';
import GithubLogin from "../implementation/github-login.js";
import {EmailLogin} from "../implementation/email-login.js";
import RedisAdapter from "../adapters/redis.js";
import {UAParser} from "ua-parser-js";

const keys = new Set();
const debug = (obj) => querystring.stringify(Object.entries(obj).reduce((acc, [key, value]) => {
    keys.add(key);
    if (isEmpty(value)) return acc;
    acc[key] = inspect(value, { depth: null });
    return acc;
}, {}), '<br/>', ': ', {
    encodeURIComponent(value) { return keys.has(value) ? `<strong>${value}</strong>` : value; },
});

const sessionDetails = async (provider, ctx) => {
    try {
        const {
            uid, prompt, params, session,
        } = await provider.interactionDetails(ctx.req, ctx.res);
        const client = await provider.Client.find(params.client_id);
        const details = prompt !== undefined ? prompt.details : {}
        return {
            uid,
            prompt,
            details,
            params,
            session,
            client
        }
    } catch (e) {
        const session = await provider.Session.get(ctx)
        return {
            uid: undefined,
            prompt: {},
            details: {},
            params: {},
            session: session,
            client: {}
        }
    }
}

const render = async (provider, ctx, template, title) => {
    const {
        uid, prompt, details, params, session, client
    } = await sessionDetails(provider, ctx)

    let dbg;
    if (process.env.DEBUG && process.env.DEBUG === 'true') {
        const sess = session !== undefined ? session : {}
        dbg = {
                params: debug(params),
                prompt: debug(prompt),
                session: debug(sess),
        };
    }

    return ctx.render(template, {
        client,
        uid,
        details,
        params,
        title,
        dbg
    });
}

const body = bodyParser({
    text: false, json: false, patchNode: true, patchKoa: true,
});

const { SessionNotFound } = errors;

export default (provider) => {
    const router = new Router();

    router.get('/', async (ctx, next) => {
        const session = await provider.Session.get(ctx)
        const signedIn = !!session.accountId
        if (signedIn) {
            return ctx.render('frontpage', { layout: false, title: 'oidc-gateway' })
        } else {
            // TODO: implement login to self.
            return render(provider, ctx, 'hi', `Welcome to oidc-gateway`)
        }
    })

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

    router.post('/api/me', bodyParser({ json: true }), async (ctx, next) => {
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

    router.post('/api/session/end', bodyParser({ json: true }), async (ctx, next) => {
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




    router.use(async (ctx, next) => {
        ctx.set('cache-control', 'no-store');
        try {
            await next();
        } catch (err) {
            if (err instanceof SessionNotFound) {
                ctx.status = err.status;
                const { message: error, error_description } = err;
                await defaults.renderError(ctx, { error, error_description }, err);
            } else {
                throw err;
            }
        }
    });

    router.get('/interaction/:uid', async (ctx, next) => {
        const { prompt, uid } = await provider.interactionDetails(ctx.req, ctx.res);
        switch (prompt.name) {
            case 'login': {
                return render(provider, ctx, 'login', 'Sign-in')
             }
            case 'consent': {
                return render(provider, ctx, 'interaction', 'Authorize')
            }
            case 'tos': {
                return render(provider, ctx, 'tos', 'Terms of Service')
            }
            case 'name': {
                return render(provider, ctx, 'enter-name', 'Enter your name')
            }
            default:
                return next();
        }
    });

    router.post('/interaction/:uid/federated', body, async (ctx) => {
        const { prompt: { name } } = await provider.interactionDetails(ctx.req, ctx.res);
        assert.equal(name, 'login');

        switch (ctx.request.body.upstream) {
            case 'gh': {
                return await GithubLogin(ctx, provider)
            }
            default:
                return undefined;
        }
    });

    router.get('/interaction/callback/gh', (ctx) => {
        const nonce = ctx.res.locals.cspNonce;
        return ctx.render('repost', { layout: false, upstream: 'gh', nonce});
    });

    router.post('/interaction/:uid/email', body, async (ctx) => {
        const emailLogin = new EmailLogin()
        return emailLogin.sendLink(ctx, provider)
    });

    router.get('/interaction/:uid/email-sent', async (ctx) => {
        return render(provider, ctx, 'email-sent', 'Email sent')
    });

    router.get('/interaction/:uid/verify-email/:token', (ctx) => {
        const emailLogin = new EmailLogin()
        return emailLogin.verifyLink(ctx, provider)
    });

    router.post('/interaction/:uid/confirm-tos', body, async (ctx) => {
        const interactionDetails = await provider.interactionDetails(ctx.req, ctx.res);
        const { prompt: { name }, session: { accountId } } = interactionDetails;
        assert.equal(name, 'tos');
        await ctx.kubeApiService.updateUser(accountId, {}, undefined, undefined, Date.now())
        return provider.interactionFinished(ctx.req, ctx.res, {}, {
            mergeWithLastSubmission: true,
        });
    });

    router.post('/interaction/:uid/update-name', body, async (ctx) => {
        const interactionDetails = await provider.interactionDetails(ctx.req, ctx.res);
        const { prompt: { name }, session: { accountId } } = interactionDetails;
        assert.equal(name, 'name');
        await ctx.kubeApiService.updateUser(accountId, {
            name: ctx.request.body.name
        }, undefined, undefined, undefined)
        return provider.interactionFinished(ctx.req, ctx.res, {}, {
            mergeWithLastSubmission: true,
        });
    });

    router.get('/interaction/:uid/abort', async (ctx) => {
        const result = {
            error: 'access_denied',
            error_description: 'End-User aborted interaction',
        };

        return provider.interactionFinished(ctx.req, ctx.res, result, {
            mergeWithLastSubmission: false,
        });
    });

    return router;
};
