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

const keys = new Set();
const debug = (obj) => querystring.stringify(Object.entries(obj).reduce((acc, [key, value]) => {
    keys.add(key);
    if (isEmpty(value)) return acc;
    acc[key] = inspect(value, { depth: null });
    return acc;
}, {}), '<br/>', ': ', {
    encodeURIComponent(value) { return keys.has(value) ? `<strong>${value}</strong>` : value; },
});

const { SessionNotFound } = errors;

export default (provider) => {
    const router = new Router();

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
        const {
            uid, prompt, params, session,
        } = await provider.interactionDetails(ctx.req, ctx.res);
        const client = await provider.Client.find(params.client_id);

        switch (prompt.name) {
            case 'login': {
                return ctx.render('login', {
                    client,
                    uid,
                    details: prompt.details,
                    params,
                    title: 'Sign-in',
                    session: session ? debug(session) : undefined,
                    dbg: {
                        params: debug(params),
                        prompt: debug(prompt),
                    },
                });
            }
            case 'consent': {
                return ctx.render('interaction', {
                    client,
                    uid,
                    details: prompt.details,
                    params,
                    title: 'Authorize',
                    session: session ? debug(session) : undefined,
                    dbg: {
                        params: debug(params),
                        prompt: debug(prompt),
                    },
                });
            }
            default:
                return next();
        }
    });

    const body = bodyParser({
        text: false, json: false, patchNode: true, patchKoa: true,
    });

    router.get('/interaction/callback/gh', (ctx) => {
        const nonce = ctx.res.locals.cspNonce;
        return ctx.render('repost', { layout: false, upstream: 'gh', nonce});
    });

    router.post('/interaction/:uid/login', body, async (ctx) => {
        const { prompt: { name } } = await provider.interactionDetails(ctx.req, ctx.res);
        assert.equal(name, 'login');

        const account = await Account.findByLogin(ctx.request.body.login);

        const result = {
            login: {
                accountId: account.accountId,
            },
        };

        return provider.interactionFinished(ctx.req, ctx.res, result, {
            mergeWithLastSubmission: false,
        });
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

    // router.post('/interaction/:uid/confirm', body, async (ctx) => {
    //     const interactionDetails = await provider.interactionDetails(ctx.req, ctx.res);
    //     const { prompt: { name, details }, params, session: { accountId } } = interactionDetails;
    //     assert.equal(name, 'consent');
    //
    //     let { grantId } = interactionDetails;
    //     let grant;
    //
    //     if (grantId) {
    //         // we'll be modifying existing grant in existing session
    //         grant = await provider.Grant.find(grantId);
    //     } else {
    //         // we're establishing a new grant
    //         grant = new provider.Grant({
    //             accountId,
    //             clientId: params.client_id,
    //         });
    //     }
    //
    //     if (details.missingOIDCScope) {
    //         grant.addOIDCScope(details.missingOIDCScope.join(' '));
    //     }
    //     if (details.missingOIDCClaims) {
    //         grant.addOIDCClaims(details.missingOIDCClaims);
    //     }
    //     if (details.missingResourceScopes) {
    //         for (const [indicator, scope] of Object.entries(details.missingResourceScopes)) {
    //             grant.addResourceScope(indicator, scope.join(' '));
    //         }
    //     }
    //
    //     grantId = await grant.save();
    //
    //     const consent = {};
    //     if (!interactionDetails.grantId) {
    //         // we don't have to pass grantId to consent, we're just modifying existing one
    //         consent.grantId = grantId;
    //     }
    //
    //     const result = { consent };
    //     return provider.interactionFinished(ctx.req, ctx.res, result, {
    //         mergeWithLastSubmission: true,
    //     });
    // });

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
