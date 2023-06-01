/* eslint-disable no-console, camelcase, no-unused-vars */
import { strict as assert } from 'node:assert';
import * as querystring from 'node:querystring';
import { inspect } from 'node:util';

import isEmpty from 'lodash/isEmpty.js';
import { koaBody as bodyParser } from 'koa-body';
import Router from 'koa-router';

import GithubLogin from "../implementation/github-login.js";
import {EmailLogin} from "../implementation/email-login.js";
import accessDenied from "../support/access-denied.js";
import getLoginResult from "../support/get-login-result.js";
import Account from "../support/account.js";
import crypto from "node:crypto";
import {Approved} from "../support/conditions/approved.js";
import {ApprovalTextName, getText, ToSTextName} from "../support/get-text.js";
import {OIDCProviderError} from "oidc-provider/lib/helpers/errors.js";
import renderError from "../support/render-error.js";
import {addGrant} from "../support/add-grants.js";
import {signedInSession} from "../support/signed-in.js";
import {addSiteSession} from "../support/site-session.js";
import {confirmTos} from "../support/confirm-tos.js";
import {checkAccountGroups} from "../support/check-account-groups.js";
import {enableAndGetRedirectUri} from "../support/enable-and-get-redirect-uri.js";
import {clientId, responseType, scope} from "../support/self-oidc-client.js";

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
        wide,
        nonce: ctx.res.locals.cspNonce,
    });
}

const body = bodyParser({
    text: false, json: false, patchNode: true, patchKoa: true,
});

export default (provider) => {
    const router = new Router();

    router.get('/', async (ctx, next) => {
        if (await signedInSession(ctx, provider)) {
            return ctx.render('frontend', { layout: false, title: 'oidc-gateway' })
        } else {
            const url = await enableAndGetRedirectUri(provider, process.env.ISSUER_URL, clientId, responseType, scope)
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
        const { prompt, session, params, grantId } = await provider.interactionDetails(ctx.req, ctx.res);
        switch (prompt.name) {
            case 'login': {
                return render(provider, ctx, 'login', 'Sign-in', {
                    impersonation: await ctx.sessionService.getImpersonation(ctx)
                })
             }
            case 'consent': {
                const client = await provider.Client.find(params.client_id);
                const account = await Account.findAccount(ctx, session.accountId);
                let result = {}
                if (!checkAccountGroups(client, account)) {
                    result.error = 'Insufficient groups'
                }
                const grant = await addGrant(provider, prompt, grantId, session.accountId, params.client_id)
                const siteSession = await addSiteSession(ctx, provider, session.jti, session.accountId, params.client_id, result)
                return provider.interactionFinished(ctx.req, ctx.res, {
                    consent: {
                        grantId: grant.jti,
                    },
                    siteSession,
                }, {
                    mergeWithLastSubmission: true,
                });
            }
            case 'tos': {
                const text = getText(ToSTextName)
                await provider.interactionResult(ctx.req, ctx.res, {
                    tosTextChecksum: crypto.createHash('sha256').update(text, 'utf8').digest('hex'),
                })
                return render(provider, ctx, 'tos', 'Terms of Service', {text}, true)
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
        assert.equal(interactionDetails.prompt.name, 'tos');
        await confirmTos(ctx, interactionDetails.session.accountId, interactionDetails.result.tosTextChecksum)
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
