/* eslint-disable no-console */
import * as path from 'node:path';
import { dirname } from 'desm';
import render from '@koa/ejs';
import oidcRoutes from './routes/oidcRoutes.js';
import apiRoutes from './routes/apiRoutes.js';
import setupProvider from "./providers/setup-provider.js";
import serve from 'koa-static';
import KubeOIDCClientOperator from "./operators/kube-oidc-client-operator.js";
import adminRoutes from "./routes/adminRoutes.js";
import forwardAuthRoutes from "./routes/forwardAuthRoutes.js";
import {setupLogger} from "./providers/setup-logger.js";
import {KubeOIDCMiddlewareClientOperator} from "./operators/kube-oidc-middleware-client-operator.js";
import KubeOidcUserOperator from "./operators/kube-oidc-user-operator.js";
import metricsServer from "./routes/metrics-server.js";

const __dirname = dirname(import.meta.url);

const { PORT = 3000 } = process.env;

let server;

try {
    setupLogger()
    const provider = await setupProvider()
    render(provider.app, {
        cache: false,
        viewExt: 'ejs',
        layout: '_layout',
        root: path.join(__dirname, 'views'),
    });
    provider.use(oidcRoutes(provider).routes());
    provider.use(apiRoutes(provider).routes());
    provider.use(adminRoutes(provider).routes());
    provider.use(forwardAuthRoutes(provider).routes());
    provider.use(serve('frontend/dist'));
    provider.use(serve('styles/dist'));
    server = provider.listen(PORT, () => {
        globalThis.logger.info(`application is listening on port ${PORT}, check its /.well-known/openid-configuration`);
    });
    metricsServer()
    const kubeClientOperator = new KubeOIDCClientOperator(provider)
    await kubeClientOperator.watchClients()
    const kubeMiddlewareClientOperator = new KubeOIDCMiddlewareClientOperator(provider)
    await kubeMiddlewareClientOperator.watchClients()
    const kubeUserOperator = new KubeOidcUserOperator(provider)
    await kubeUserOperator.watchUsers()
} catch (err) {
    if (server?.listening) server.close();
    console.error(err);
    process.exitCode = 1;
}
