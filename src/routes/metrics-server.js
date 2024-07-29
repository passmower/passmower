import {collectDefaultMetrics, register} from "prom-client";
import Koa from 'koa';
import Router from "koa-router";
import { setupOidcMetrics } from "../utils/session/handle-oidc-flow-metrics.js";
import {KubeOIDCUserService} from "../services/kube-oidc-user-service.js";
import {getSelfOidcClient} from "../utils/session/self-oidc-client.js";

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
        ctx.status = await userService.listUsers() && await getSelfOidcClient() ? 200 : 500;
    })
    metricsServer.use(router.routes())
    metricsServer.listen(9090)
}
