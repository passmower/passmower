import crypto from "node:crypto";
import RedisAdapter from "../adapters/redis.js";
import {promisify} from "node:util";
import helmet from "helmet";
import {SessionService} from "../services/session-service.js";
import {KubeOIDCUserService} from "../services/kube-oidc-user-service.js";
import {clientId} from "../utils/session/self-oidc-client.js";
import instance from "oidc-provider/lib/helpers/weak_cache.js";
import {OIDCMiddlewareClientCrd} from "../utils/kubernetes/kube-constants.js";
import Account from "../models/account.js";
import nanoid from "oidc-provider/lib/helpers/nanoid.js";

export default async (provider) => {
    const sessionMetadataRedis = new RedisAdapter('SessionMetadata')

    const directives = helmet.contentSecurityPolicy.getDefaultDirectives();
    delete directives['form-action'];
    directives['script-src'] = ["'self'", (req, res) => `'nonce-${res.locals.cspNonce}'`];

    const pHelmet = promisify(helmet({
        contentSecurityPolicy: {
            useDefaults: false,
            directives,
        },
    }));

    provider.use(async (ctx, next) => {
        const origSecure = ctx.req.secure;
        ctx.req.secure = ctx.request.secure;
        // eslint-disable-next-line no-unused-expressions
        ctx.res.locals ||= {};
        ctx.res.locals.cspNonce = crypto.randomBytes(16).toString('base64');
        await pHelmet(ctx.req, ctx.res);
        ctx.req.secure = origSecure;
        return next();
    });

    provider.use(async (ctx, next) => {
        await next();
        if (ctx.oidc?.route === 'resume' && ctx.oidc?.entities?.Interaction?.result?.consent) {
            const session = ctx.oidc.entities.Session
            const headers = { ...ctx.request.headers }
            delete headers.cookies
            await sessionMetadataRedis.upsert(nanoid(), {
                ...headers,
                sessionId: session.jti,
                userId: session?.uid, // Must not be named uid because RedisAdapter's upsert has mechanism which breaks stuff if random uid is encountered.
                client: ctx.oidc.entities.Client,
                iat: session.iat ?? (Math.floor(Date.now() / 1000)),
                exp: session?.exp,
                ts: Math.floor(Date.now() / 1000),
            }, (session.exp ? (session.exp - Math.floor(Date.now() / 1000)) : undefined) ?? instance(provider).configuration('ttl.Session'))
            await ctx.sessionService.cleanupSessions(session.accountId)
        }
    });

    provider.use(async (ctx, next) => {
        await next();
        if (ctx.oidc?.route === 'resume') {
            if (ctx?.oidc?.entities?.Client?.clientId === clientId || ctx?.oidc?.entities?.Client?.kind === OIDCMiddlewareClientCrd) {
                if (ctx.oidc?.entities?.Interaction?.result?.consent) {
                    // Violate RFC for selfOIDCClient - no parameters when redirecting to dashboard or forwardAuth origin.
                    ctx.redirect(ctx?.oidc?.entities?.Interaction?.params?.redirect_uri)
                }
            }
        }
    });

    provider.use(async (ctx, next) => {
        ctx.kubeOIDCUserService = new KubeOIDCUserService()
        ctx.sessionService = new SessionService(provider)
        return next();
    });

    provider.on('authorization.error', async (ctx, error) => {
        const session = await provider.Session.get(ctx)
        await ctx.sessionService.endOIDCSession(session.jti, {
            redirect: () => {}
        }, () => {})
    })

    provider.use(async (ctx, next) => {
        const session = await provider.Session.get(ctx)
        ctx.currentSession = session.accountId ? session : undefined
        if (ctx.currentSession?.accountId) {
            ctx.currentAccount = await Account.findAccount(ctx, ctx.currentSession.accountId)
            if (!ctx.currentAccount) {
                await ctx.sessionService.endOIDCSession(ctx.currentSession.jti, {
                    redirect: () => {}
                }, () => {})
            }
        }
        return next();
    });

    provider.use(async (ctx, next) => {
        try {
            if (ctx.method === 'GET' && ctx.path === '/auth') {
                let url = new URL(`http://localhost${ctx.url}`)
                if (url.searchParams.has('client_id')) {
                    const client = await provider.Client.find(url.searchParams.get('client_id'));
                    if (client.overrideIncomingScopes) {
                        url.searchParams.set('scope', client.availableScopes.join(' '))
                        ctx.url = url.pathname + url.search
                    }
                }
            }
        } catch (error) {
            globalThis.logger.error({url: ctx?.url, error}, 'Error handling incoming scopes, continuing without changes')
        }
        await next();
    });

    return provider
}
