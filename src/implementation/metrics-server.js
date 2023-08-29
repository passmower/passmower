import {collectDefaultMetrics, register} from "prom-client";
import Koa from 'koa';
import Router from "koa-router";
import { setupOidcMetrics } from "../support/handle-oidc-flow-metrics.js";

export default async () => {
    collectDefaultMetrics({
        timeout: 10000,
        gcDurationBuckets: [0.001, 0.01, 0.1, 1, 2, 5], // These are the default buckets.
    });
    register.setDefaultLabels({
        gateway: process.env.ISSUER_URL,
        deployment: process.env.DEPLOYMENT_NAME,
    })
    globalThis.metrics = {}
    setupOidcMetrics()
    const metricsServer = new Koa();
    const router = new Router();
    router.get('/metrics', async (ctx, next) => {
        ctx.body = await register.metrics()
    })
    metricsServer.use(router.routes())
    metricsServer.listen(9090)
}
