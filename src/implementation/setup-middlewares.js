import crypto from "node:crypto";
import RedisAdapter from "../adapters/redis.js";
import {promisify} from "node:util";
import helmet from "helmet";
import {SessionService} from "./session-service.js";
import {KubeApiService} from "./kube-api-service.js";

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
        if (ctx.oidc?.route === 'resume') {
            const session = ctx.oidc.entities.Session
            await accountSessionRedis.appendToSet(session.accountId, session.jti)
            await sessionMetadataRedis.upsert(session.jti, {...ctx.request.headers, iat: session.iat ?? (Date.now() / 1000)})
        }
    });

    provider.use(async (ctx, next) => {
        ctx.kubeApiService = new KubeApiService()
        ctx.sessionService = new SessionService(provider)
        return next();
    });

    return provider
}
