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
import {signedInToSelf} from "../support/signed-in.js";
import {addSiteSession} from "../support/site-session.js";
import {confirmTos} from "../support/confirm-tos.js";
import {checkAccountGroups} from "../support/check-account-groups.js";
import {enableAndGetRedirectUri} from "../support/enable-and-get-redirect-uri.js";
import {clientId, responseType, scope} from "../support/self-oidc-client.js";
import {auditLog} from "../support/audit-log.js";
import {UsernameCommitted} from "../support/conditions/username-committed.js";
import validator, {checkEmail, checkRealName, checkUsername} from "../support/validator.js";

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

export default (provider) => {
    const router = new Router();
    router.use(bodyParser({
        text: false, json: false, patchNode: true, patchKoa: true,
    }))
    router.use(validator)

    router.get(['/', '/profile', '/terms-of-service'], async (ctx, next) => {
        if (await signedInToSelf(ctx, provider)) {
            if (ctx.path === '/terms-of-service') {
                // TODO: proper implementation
                const text = getText(ToSTextName)
                return render(provider, ctx, 'tos', 'Terms of Service', {text, save: false}, true)
            } else {
                return ctx.render('frontend', { layout: false, title: 'oidc-gateway' })
            }
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
        const interactionDetails = await provider.interactionDetails(ctx.req, ctx.res);
        const { prompt, session, params, grantId } = interactionDetails
        switch (prompt.name) {
            case 'login': {
                if (interactionDetails?.lastSubmission?.requireCustomUsername) {
                    return render(provider, ctx, 'enter-username', 'Enter username', {errors: undefined, preferredUsername: interactionDetails?.lastSubmission?.preferredUsername}, true)
                }
                return render(provider, ctx, 'login', 'Sign-in', {
                    impersonation: await ctx.sessionService.getImpersonation(ctx),
                    message: undefined
                })
             }
            case 'consent': {
                const client = await provider.Client.find( params.client_id);
                const grant = await addGrant(provider, prompt, grantId, session.accountId, client)
                let siteSession;
                if (client.kind) {
                    siteSession = await addSiteSession(ctx, provider, session.jti, session.accountId, client)
                }
                auditLog(ctx, {interactionDetails, grant, siteSession}, 'Client authorized')
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
                return render(provider, ctx, 'tos', 'Terms of Service', {text, save: true}, true)
            }
            case 'approval_required': {
                // Check again so when user gets approved and refreshes the interaction page, flow can continue.
                if ((new Approved()).check(ctx.currentAccount)) {
                    return provider.interactionFinished(ctx.req, ctx.res, {}, {
                        mergeWithLastSubmission: true,
                    });
                }
                auditLog(ctx, {interactionDetails}, 'User is not authorized')
                return render(provider, ctx, 'approval_required', 'Approval required', {
                    text: getText(ApprovalTextName)
                }, true)
            }
            case 'groups_required': {
                // Check again so when user gets assigned into a required group and refreshes the interaction page, flow can continue.
                const client = await provider.Client.find(params.client_id);
                if (checkAccountGroups(client, ctx.currentAccount)) {
                    return provider.interactionFinished(ctx.req, ctx.res, {}, {
                        mergeWithLastSubmission: true,
                    });
                }
                auditLog(ctx, {interactionDetails}, 'User does not have required groups')
                return render(provider, ctx, 'message', 'Access denied', {
                    message: 'You need to be a member of an allowed group to access this resource'
                }, true)
            }
            case 'name': {
                return render(provider, ctx, 'enter-name', 'Enter your name', {
                    message: undefined,
                })
            }
            default:
                return next();
        }
    });

    router.post('/interaction/:uid/federated', async (ctx) => {
        const { prompt: { name } } = await provider.interactionDetails(ctx.req, ctx.res);
        assert.equal(name, 'login');

        switch (ctx.request.body.upstream) {
            case 'gh': {
                auditLog(ctx, {}, ctx.request.body.code ? 'GitHub login callback received' : 'GitHub login initiated')
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

    router.post('/interaction/:uid/email', async (ctx) => {
        checkEmail(ctx)
        if (await ctx.validationErrors()) {
            return render(provider, ctx, 'login', 'Sign-in', {
                impersonation: undefined,
                message: 'Invalid email'
            })
        }
        auditLog(ctx, {email: ctx.request.body.email}, 'Email login initiated')
        const emailLogin = new EmailLogin()
        return emailLogin.sendLink(ctx, provider)
    });

    router.post('/interaction/:uid/impersonate', async (ctx) => {
        const impersonation = await ctx.sessionService.getImpersonation(ctx)
        const account = await Account.findAccount(ctx, impersonation.accountId)
        auditLog(ctx, {impersonation, account}, 'Impersonation used to log in')
        return provider.interactionFinished(ctx.req, ctx.res, await getLoginResult(ctx, provider, account, 'Impersonation'), {
            mergeWithLastSubmission: true,
        });
    });

    router.get('/interaction/:uid/email-sent', async (ctx) => {
        return render(provider, ctx, 'message', 'Email sent', {
            message: 'Please check your inbox'
        })
    });

    router.get('/interaction/:uid/slack-sent', async (ctx) => {
        return render(provider, ctx, 'message', 'Message sent', {
            message: 'Please check your Slack or email inbox'
        })
    });

    router.get('/interaction/:uid/verify-email/:token', (ctx) => {
        const emailLogin = new EmailLogin()
        const result = emailLogin.verifyLink(ctx, provider)
        auditLog(ctx, {params: ctx.request.params, result}, 'Login link used')
        return result
    });

    router.post('/interaction/:uid/confirm-tos', async (ctx) => {
        const interactionDetails = await provider.interactionDetails(ctx.req, ctx.res);
        assert.equal(interactionDetails.prompt.name, 'tos');
        await confirmTos(ctx, interactionDetails.session.accountId, interactionDetails.result.tosTextChecksum)
        auditLog(ctx, {interactionDetails}, 'ToS approved')
        return provider.interactionFinished(ctx.req, ctx.res, {}, {
            mergeWithLastSubmission: true,
        });
    });

    router.post('/interaction/:uid/update-name', async (ctx) => {
        const interactionDetails = await provider.interactionDetails(ctx.req, ctx.res);
        const { prompt: { name }, session: { accountId } } = interactionDetails;
        assert.equal(name, 'name');

        checkRealName(ctx)
        if (await ctx.validationErrors()) {
            return render(provider, ctx, 'enter-name', 'Enter your name', {
                message: 'Invalid name'
            })
        }

        await ctx.kubeOIDCUserService.updateUserSpec({
            accountId,
            customProfile: {
                name: ctx.request.body.name
            }
        })
        auditLog(ctx, {interactionDetails, name: ctx.request.body.name}, 'User name updated')
        return provider.interactionFinished(ctx.req, ctx.res, {}, {
            mergeWithLastSubmission: true,
        });
    });

    router.post('/interaction/:uid/enter-username', async (ctx) => {
        const interactionDetails = await provider.interactionDetails(ctx.req, ctx.res);
        const { prompt: { name } } = interactionDetails;
        assert.equal(name, 'login');
        const username = ctx.request.body.username
        checkUsername(ctx)
        let errors = await ctx.validationErrors()
        if (errors) {
            return render(provider, ctx, 'enter-username', 'Enter username', {
                errors,
                preferredUsername: username,
            }, true)
        }

        const account = await ctx.kubeOIDCUserService.createUser(username, interactionDetails.lastSubmission?.email, interactionDetails.lastSubmission?.githubEmails)
        let condition = new UsernameCommitted()
        condition = condition.setStatus(true)
        account.addCondition(condition)
        await ctx.kubeOIDCUserService.updateUserStatus(account)

        if (interactionDetails?.lastSubmission?.oauth?.provider) {
            switch (interactionDetails.lastSubmission.oauth.provider) {
                case "GitHub":
                    await GithubLogin(ctx, provider)
                    break
                default:
                    throw new Error('not implemented')
            }
        } else {
            return provider.interactionFinished(ctx.req, ctx.res, {
                login: {
                    accountId: account.accountId,
                }
            }, {
                mergeWithLastSubmission: true,
            });
        }
    });


    router.get('/interaction/:uid/abort', async (ctx) => {
        return accessDenied(ctx, provider,  'End-User aborted interaction')
    });

    return router;
};
