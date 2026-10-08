import Router from "@koa/router";
import {koaBody as bodyParser} from "koa-body";
import {validateSiteSession} from "../utils/session/site-session.js";
import Account from "../models/account.js";
import RedisAdapter from "../adapters/redis.js";
import {authorizationUrl} from "../utils/session/authorization-url.js";
import {
    forwardAuthRedirectUri,
    forwardAuthReturnPath,
    requestedUrl,
    signReturnState,
    verifyReturnState,
} from "../utils/session/forward-auth-return.js";
import {responseType, scope} from "../models/oidc-middleware-client.js";
import {OIDCMiddlewareClientCrd} from "../utils/kubernetes/kube-constants.js";
import {getAccountAccessFailure} from '../utils/user/check-account-access.js';
import {auditLog} from '../utils/session/audit-log.js';
import {recordIncident} from '../utils/session/incident-log.js';

export default (provider) => {
    const router = new Router();

    router.get('/forward-auth', async (ctx) => {
        ctx.status = 401
        const clientId = ctx.query.client
        if (!clientId) {
            ctx.body = 'client parameter in authentication url is missing'
            return
        }

        const redisAdapter = new RedisAdapter('Client')
        const client = await redisAdapter.find(clientId)
        if (client?.kind !== OIDCMiddlewareClientCrd) {
            ctx.body = 'unknown client'
            return
        }

        const url = requestedUrl(ctx.req.headers)
        if (!url) {
            ctx.body = 'Endpoint URL not in the same base domain'
            return
        }

        const cookie = await validateSiteSession(ctx, clientId)
        if (cookie) {
            if (cookie?.result?.error) {
                ctx.body = cookie.result.error
            } else {
                const account = await Account.findAccount(ctx, cookie.accountId)
                const failure = getAccountAccessFailure(client, account)
                if (!failure) {
                    const remoteHeaders = account.getRemoteHeaders(client.headerMapping)
                    Object.keys(remoteHeaders).map(k => {
                        ctx.set(k, remoteHeaders[k])
                    })
                    ctx.status = 200
                } else {
                    auditLog(ctx, {accountId: cookie.accountId, clientId, failure},
                        'Forward-auth account no longer satisfies access policy')
                    await recordIncident(ctx, {
                        source: 'forward-auth',
                        accountId: cookie.accountId,
                        clientId,
                        failure,
                        allowedGroups: client.allowedGroups,
                        allowedUsers: client.allowedUsers,
                    })
                }
            }
        } else {
            return ctx.redirect(authorizationUrl(provider, {
                client_id: clientId,
                response_type: responseType,
                response_mode: 'form_post',
                scope,
                redirect_uri: forwardAuthRedirectUri(),
                state: signReturnState(provider, url),
            }).href)
        }
    });

    // Every authorization response for a forward-auth client lands here; the
    // signed state says where the user was going. On an error the user goes
    // back to that page too, so the application's next request restarts
    // sign-in instead of stranding them on Passmower.
    router.post(forwardAuthReturnPath, bodyParser({json: false, multipart: false}), async (ctx) => {
        const {state, error} = ctx.request.body ?? {}
        const target = verifyReturnState(provider, state)
        if (target) {
            ctx.status = 303
            return ctx.redirect(target)
        }
        // Anyone can post here, so only a well-formed error code is echoed.
        if (error) {
            ctx.status = 403
            ctx.body = /^[a-z_]{1,64}$/.test(error) ? `Sign-in was not completed: ${error}` : 'Sign-in was not completed'
            return
        }
        ctx.status = 400
        ctx.body = 'Invalid or expired sign-in state'
    });

    return router
}

