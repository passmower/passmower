import {collectDefaultMetrics, register} from "prom-client";
import Koa from 'koa';
import Router from "@koa/router";
import { setupOidcMetrics } from "../utils/session/handle-oidc-flow-metrics.js";
import {KubeOIDCUserService} from "../services/kube-oidc-user-service.js";
import RedisAdapter from "../adapters/redis.js";

// Health check: verifies the Kubernetes API is reachable AND that Redis is
// actually writable (a read-only replica or failing writes would pass a
// read-only check but break the app — #77). Throws if a dependency is down.
export const checkHealth = async (userService) => {
    const redis = new RedisAdapter('HealthCheck')
    const token = `${Date.now()}-${process.pid}`
    await redis.upsert('probe', { token }, 60)
    const probe = await redis.find('probe')
    const usersReachable = Array.isArray(await userService.listUsers())
    return Boolean(usersReachable && probe?.token === token)
}

export default async () => {
    collectDefaultMetrics({
        timeout: 10000,
        gcDurationBuckets: [0.001, 0.01, 0.1, 1, 2, 5], // These are the default buckets.
    });
    register.setDefaultLabels({
        instance: process.env.ISSUER_URL,
        deployment: process.env.DEPLOYMENT_NAME,
    })
    globalThis.metrics = {}
    setupOidcMetrics()

    const userService = new KubeOIDCUserService();

    const metricsServer = new Koa();
    const router = new Router();
    router.get('/metrics', async (ctx, next) => {
        ctx.body = await register.metrics()
    })

    router.get('/health', async (ctx, next) => {
        try {
            ctx.status = await checkHealth(userService) ? 200 : 500;
        } catch (err) {
            globalThis.logger?.error({ err }, 'health check failed');
            ctx.status = 500;
        }
    })
    metricsServer.use(router.routes())
    metricsServer.listen(9090)
}
