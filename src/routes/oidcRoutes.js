/* eslint-disable no-console, camelcase, no-unused-vars */
import { strict as assert } from 'node:assert';
import * as querystring from 'node:querystring';
import { inspect } from 'node:util';

import isEmpty from 'lodash/isEmpty.js';
import { koaBody as bodyParser } from 'koa-body';
import Router from 'koa-router';

import { errors } from 'oidc-provider';
import GithubLogin from "../implementation/github-login.js";
import {EmailLogin} from "../implementation/email-login.js";
import accessDenied from "../support/access-denied.js";
import { enableAndGetRedirectUri } from "../support/self-oidc-client.js";
import getLoginResult from "../support/get-login-result.js";
import Account from "../support/account.js";
import {ToSv1} from "../support/conditions/tosv1.js";
import {Approved} from "../support/conditions/approved.js";
import {ApprovalTextName, getText, ToSTextName} from "../support/get-text.js";
import {OIDCProviderError} from "oidc-provider/lib/helpers/errors.js";
import renderError from "../support/render-error.js";

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

const render = async (provider, ctx, template, title, extra, wide = false) => {
    const {
        uid, prompt, details, params, session, client
    } = await sessionDetails(provider, ctx)

    let dbg;
    if (process.env.NODE_ENV !== 'production') {
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
        dbg,
        ...extra,
        wide
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
            return ctx.render('frontend', { layout: false, title: 'oidc-gateway' })
        } else {
            const url = await enableAndGetRedirectUri(provider, process.env.ISSUER_URL)
            return render(provider, ctx, 'hi', `Welcome to oidc-gateway`, {
                url: url.href
            })
        }
    })

    router.use(async (ctx, next) => {
        ctx.set('cache-control', 'no-store');
        try {
            await next();
        } catch (err) {
            if (err instanceof OIDCProviderError) {
                ctx.status = err.status;
                const { message: error, error_description } = err;
                await renderError(ctx, { error, error_description }, err);
            } else {
                throw err;
            }
        }
    });

    router.get('/interaction/:uid', async (ctx, next) => {
        const { prompt, session } = await provider.interactionDetails(ctx.req, ctx.res);
        switch (prompt.name) {
            case 'login': {
                return render(provider, ctx, 'login', 'Sign-in', {
                    impersonation: await ctx.sessionService.getImpersonation(ctx)
                })
             }
            case 'consent': {
                return render(provider, ctx, 'interaction', 'Authorize')
            }
            case 'tos': {
                return render(provider, ctx, 'tos', 'Terms of Service', {
                    text: getText(ToSTextName)
                }, true)
            }
            case 'approval_required': {
                const kubeUser = await ctx.kubeOIDCUserService.findUser(session.accountId)
                if (kubeUser.checkCondition(new Approved())) {
                    return provider.interactionFinished(ctx.req, ctx.res, {}, {
                        mergeWithLastSubmission: true,
                    });
                }
                return render(provider, ctx, 'approval_required', 'Approval required', {
                    text: getText(ApprovalTextName)
                }, true)
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

    router.post('/interaction/:uid/impersonate', body, async (ctx) => {
        const impersonation = await ctx.sessionService.getImpersonation(ctx)
        const account = await Account.findAccount(ctx, impersonation.accountId)
        return provider.interactionFinished(ctx.req, ctx.res, await getLoginResult(ctx, provider, account), {
            mergeWithLastSubmission: true,
        });
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
        let account = await Account.findAccount(ctx, accountId)
        let condition = new ToSv1()
        condition = condition.setStatus(true)
        account.addCondition(condition.toKubeCondition())
        await ctx.kubeOIDCUserService.updateUserStatus(account)
        return provider.interactionFinished(ctx.req, ctx.res, {}, {
            mergeWithLastSubmission: true,
        });
    });

    router.post('/interaction/:uid/update-name', body, async (ctx) => {
        const interactionDetails = await provider.interactionDetails(ctx.req, ctx.res);
        const { prompt: { name }, session: { accountId } } = interactionDetails;
        assert.equal(name, 'name');
        await ctx.kubeOIDCUserService.updateUserSpec({
            accountId,
            customProfile: {
                name: ctx.request.body.name
            }
        })
        return provider.interactionFinished(ctx.req, ctx.res, {}, {
            mergeWithLastSubmission: true,
        });
    });

    router.get('/interaction/:uid/abort', async (ctx) => {
        return accessDenied(ctx, provider,  'End-User aborted interaction')
    });

    return router;
};
