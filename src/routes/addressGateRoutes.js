import Router from "@koa/router";
import instance from "oidc-provider/lib/helpers/weak_cache.js";
import {
    addressGateEnabled,
    gateDecision,
    sessionUnlockEnabled,
    unlockAddress,
} from "../services/address-gate.js";
import {requestIp} from "../utils/session/parse-request-headers.js";
import {requestedUrl, signReturnState, verifyReturnState} from "../utils/session/forward-auth-return.js";
import {auditLog} from "../utils/session/audit-log.js";
import {AuditService} from "../services/audit-service.js";

export const addressGatePath = '/address-gate'
export const addressGateUnlockPath = '/address-gate/unlock'
// Carries a pending unlock across the sign-in, which always returns to the
// dashboard.
export const addressGateCookie = '_address_gate'

export const addressGateCookieOptions = (provider) => ({
    ...instance(provider).configuration.cookies.short,
    path: '/',
    signed: true,
    maxAge: instance(provider).configuration.ttl.Interaction * 1000,
})

export const unlockUrl = (state) =>
    `${process.env.ISSUER_URL}${addressGateUnlockPath.slice(1)}?state=${encodeURIComponent(state)}`

// A browser navigating to a page can be sent to sign in; an API call, an
// asset or a form post gets a plain 403 it can act on.
const isPageNavigation = (ctx) =>
    (ctx.get('x-forwarded-method') || 'GET').toUpperCase() === 'GET'
    && (ctx.get('accept') ?? '').includes('text/html')

export default (provider) => {
    const router = new Router();

    // forwardAuth target. Traefik passes the original request's headers,
    // including the X-Forwarded-For it sanitised at its entrypoint.
    router.get(addressGatePath, async (ctx) => {
        if (!addressGateEnabled()) {
            ctx.status = 404
            return
        }
        const ip = requestIp(ctx)
        const decision = await gateDecision(ip, {
            findSessionByUid: (uid) => provider.Session.findByUid(uid),
        })
        globalThis.metrics?.addressGateRequests?.inc({
            result: decision.allowed ? 'allowed' : 'denied',
            rule: decision.rule,
        })
        if (decision.allowed) {
            ctx.status = 200
            ctx.body = ''
            return
        }
        globalThis.logger?.debug({ip, country: decision.country, asn: decision.asn}, 'Address gate refused a request')
        const url = requestedUrl(ctx.req.headers)
        if (sessionUnlockEnabled() && url && isPageNavigation(ctx)) {
            return ctx.redirect(unlockUrl(signReturnState(provider, url)))
        }
        ctx.status = 403
        ctx.body = 'Access from this address is not allowed'
    })

    router.get(addressGateUnlockPath, async (ctx) => {
        if (!addressGateEnabled() || !sessionUnlockEnabled()) {
            ctx.status = 404
            return
        }
        const target = verifyReturnState(provider, ctx.query.state)
        if (!target) {
            ctx.status = 400
            return ctx.render('message', {
                title: 'Link expired',
                message: 'This link is invalid or has expired. Open the application again.',
                wide: false, uid: null, dbg: undefined, nonce: ctx.res.locals.cspNonce,
            })
        }
        if (!ctx.currentSession?.accountId) {
            ctx.cookies.set(addressGateCookie, ctx.query.state, addressGateCookieOptions(provider))
            return ctx.redirect('/')
        }
        const session = ctx.currentSession
        const {key, already} = await unlockAddress(requestIp(ctx), session, instance(provider).configuration.ttl.Session)
        if (already) {
            // Redirecting back would only bounce between the gate and here.
            auditLog(ctx, {accountId: session.accountId, address: key, target: new URL(target).origin},
                'Address gate unlock repeated: the application sees this browser at another address')
            ctx.status = 409
            return ctx.render('message', {
                title: 'Different network address',
                message: 'The application sees your connection at a different address than Passmower does, usually because one of them is reached over IPv4 and the other over IPv6. Ask your administrator to allow your network.',
                wide: false, uid: null, dbg: undefined, nonce: ctx.res.locals.cspNonce,
            })
        }
        auditLog(ctx, {accountId: session.accountId, address: key, target: new URL(target).origin},
            'Address gate unlocked for a signed-in session')
        new AuditService().write({
            event: 'address-gate.unlocked',
            result: 'success',
            subject: {id: session.accountId},
        }, ctx)
        globalThis.metrics?.addressGateUnlocks?.inc()
        ctx.redirect(target)
    })

    return router
}
