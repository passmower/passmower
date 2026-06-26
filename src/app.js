/* eslint-disable no-console */
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
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
import {getUsernameSource} from "./utils/username-source.js";

const __dirname = dirname(import.meta.url);

const { PORT = 3000 } = process.env;

// Construct the fully-wired oidc-provider (views, routes, static assets) without
// binding a port or starting the metrics server / Kubernetes operators. This is
// the seam used by HTTP-level tests, which drive it via supertest(provider.callback()).
export async function buildProvider() {
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
    return provider
}

// Start the operators that watch the cluster for OIDC client/user resources.
export async function startOperators(provider) {
    const kubeClientOperator = new KubeOIDCClientOperator(provider)
    await kubeClientOperator.watchClients()
    const kubeMiddlewareClientOperator = new KubeOIDCMiddlewareClientOperator(provider)
    await kubeMiddlewareClientOperator.watchClients()
    const kubeUserOperator = new KubeOidcUserOperator(provider)
    await kubeUserOperator.watchUsers()
}

// Boot the full application. Skipped when imported as a module (e.g. by tests),
// which import buildProvider()/startOperators() directly.
export async function main() {
    let server;
    try {
        setupLogger()
        getUsernameSource() // validate USERNAME_SOURCE (and warn on deprecated flags) at boot
        const provider = await buildProvider()
        server = provider.listen(PORT, () => {
        globalThis.logger.info(`application is listening on port ${PORT}, check its /.well-known/openid-configuration`);
    });
    metricsServer()
    await startOperators(provider)
    } catch (err) {
        if (server?.listening) server.close();
        console.error(err);
        process.exitCode = 1;
    }
}

// Only boot when run directly (node src/app.js), not when imported by tests.
if (process.argv[1] === fileURLToPath(import.meta.url)) {
    await main();
}
