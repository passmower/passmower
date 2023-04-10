import Provider from "oidc-provider";
import configuration from "../support/configuration.js";
import crypto from "node:crypto";
import helmet from "helmet";
import {promisify} from "node:util";
import {KubeApiService} from "./kube-api-service.js";
import setupPolicies from "./setup-policies.js";
import RedisAdapter from "../adapters/redis.js";
import { randomUUID } from 'crypto';

export default async () => {
    let adapter;
    if (process.env.REDIS_URI) {
        ({ default: adapter } = await import('../adapters/redis.js'));
    }
    const accountSessionRedis = new RedisAdapter('AccountSession')
    const sessionMetadataRedis = new RedisAdapter('SessionMetadata')

    const kubeApiService = new KubeApiService()
    configuration.interactions.policy = setupPolicies(kubeApiService)
    configuration.clients = [
        ...await kubeApiService.getClients(),
        {
            client_id: 'oidc-gateway',
            client_secret: randomUUID(), // TODO: what if multiple instances?
            grant_types: ['implicit'],
            response_types: ['id_token'],
            redirect_uris: [process.env.ISSUER_URL],
        }
    ]
    configuration.jwks.keys = JSON.parse(process.env.OIDC_JWKS)
    const provider = new Provider(process.env.ISSUER_URL, { adapter, ...configuration });
    provider.proxy = true
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
        if (ctx.oidc !== undefined && ctx.oidc.route === 'resume') {
            const session = ctx.oidc.entities.Session
            await accountSessionRedis.appendToSet(session.accountId, session.jti)
            await sessionMetadataRedis.upsert(session.jti, {...ctx.request.headers, iat: session.iat})
        }
    });

    provider.use(async (ctx, next) => {
        ctx.kubeApiService = kubeApiService
        return next();
    });

    const directives = helmet.contentSecurityPolicy.getDefaultDirectives();
    delete directives['form-action'];
    directives['script-src'] = ["'self'", (req, res) => `'nonce-${res.locals.cspNonce}'`];
    const pHelmet = promisify(helmet({
        contentSecurityPolicy: {
            useDefaults: false,
            directives,
        },
    }));

    return provider
}
