import crypto from "node:crypto";
import RedisAdapter from "../adapters/redis.js";
import {promisify} from "node:util";
import helmet from "helmet";
import {SessionService} from "./session-service.js";
import {KubeOIDCUserService} from "./kube-oidc-user-service.js";
import {clientId} from "../support/self-oidc-client.js";
import instance from "oidc-provider/lib/helpers/weak_cache.js";

export default async (provider) => {
    const accountSessionRedis = new RedisAdapter('AccountSession')
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
            await accountSessionRedis.appendToSet(session.accountId, session.jti)
            await sessionMetadataRedis.upsert(session.jti, {...ctx.request.headers, iat: session.iat ?? (Date.now() / 1000)}, instance(provider).configuration('ttl.Session'))
            await ctx.sessionService.cleanupSessions(session.accountId)
        }
    });

    provider.use(async (ctx, next) => {
        await next();
        if (ctx.oidc?.route === 'resume') {
            if (ctx?.oidc?.entities?.Client?.clientId === clientId) {
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

    return provider
}
