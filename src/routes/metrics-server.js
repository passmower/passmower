import {collectDefaultMetrics, Gauge, register} from "prom-client";
import Koa from 'koa';
import Router from "@koa/router";
import { setupOidcMetrics } from "../utils/session/handle-oidc-flow-metrics.js";
import { setupUsageMetrics } from "../utils/usage-metrics.js";
import {KubeOIDCUserService} from "../services/kube-oidc-user-service.js";
import RedisAdapter from "../adapters/redis.js";

// Readiness: can this pod serve a request right now? That means the Kubernetes
// API is reachable and Redis is actually writable — a read-only replica or
// failing writes pass a read-only check but break the app (#77). Throws if a
// dependency is down.
//
// This is a readiness question, not a liveness one (#265). Neither dependency
// is something the pod can fix by dying: the Redis client reconnects on its own
// and the process stays healthy throughout, so restarting only throws away a
// warm pod and, because every replica probes the same Redis, restarts all of
// them at once. Failing readiness instead takes the pod out of the Service for
// exactly as long as the outage lasts.
export const checkReadiness = async (userService) => {
    const redis = new RedisAdapter('HealthCheck')
    const token = `${Date.now()}-${process.pid}`
    await redis.upsert('probe', { token }, 60)
    const probe = await redis.find('probe')
    const usersReachable = Array.isArray(await userService.listUsers())
    return Boolean(usersReachable && probe?.token === token)
}

// The two probe routes, separated from the server so they can be exercised
// without binding a port. isServing reports whether the main provider listener
// on port 3000 is up: the readiness probe used to hit that port's discovery
// document directly, and moving readiness here must not quietly drop the "has
// it finished booting" half of what that probe answered.
export const probeRoutes = (router, {userService, isServing = () => true}) => {
    // Liveness: is this process still turning its event loop? Answering at all
    // is the whole answer. It deliberately touches no dependency — a probe that
    // restarts the pod over someone else's outage is worse than no probe.
    router.get('/health', async (ctx, next) => {
        ctx.status = 200;
        ctx.body = 'ok';
    })

    router.get('/ready', async (ctx, next) => {
        try {
            ctx.status = isServing() && await checkReadiness(userService) ? 200 : 503;
        } catch (err) {
            globalThis.logger?.warn({ err }, 'readiness check failed');
            ctx.status = 503;
        }
    })
    return router
}

export default async ({isServing = () => true} = {}) => {
    collectDefaultMetrics({
        timeout: 10000,
        gcDurationBuckets: [0.001, 0.01, 0.1, 1, 2, 5], // These are the default buckets.
    });
    register.setDefaultLabels({
        instance: process.env.ISSUER_URL,
        deployment: process.env.DEPLOYMENT_NAME,
    })
    globalThis.metrics = {}
    globalThis.metrics.oidcClientLastUsed = new Gauge({
        name: 'passmower_oidc_client_last_used_timestamp_seconds',
        help: 'Unix timestamp of the latest successful OIDC activity for a client, or zero if never used',
        labelNames: ['kind', 'namespace', 'client'],
    })
    globalThis.metrics.oidcUserEmailConflicts = new Gauge({
        name: 'passmower_oidc_user_email_conflicts',
        help: 'Number of OIDCUser resources rejected because an older user owns one or more claimed emails',
    })
    setupOidcMetrics()
    setupUsageMetrics()

    const userService = new KubeOIDCUserService();

    const metricsServer = new Koa();
    const router = new Router();
    router.get('/metrics', async (ctx, next) => {
        ctx.body = await register.metrics()
    })

    probeRoutes(router, {userService, isServing})
    metricsServer.use(router.routes())
    metricsServer.listen(9090)
}
