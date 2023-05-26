/* eslint-disable no-console */
import * as path from 'node:path';
import { dirname } from 'desm';
import render from '@koa/ejs';
import oidcRoutes from './routes/oidcRoutes.js';
import apiRoutes from './routes/apiRoutes.js';
import setupProvider from "./implementation/setup-provider.js";
import serve from 'koa-static';
import KubeOIDCClientOperator from "./implementation/kube-oidc-client-operator.js";
import adminRoutes from "./routes/adminRoutes.js";
import forwardAuthRoutes from "./routes/forwardAuthRoutes.js";
import pino from "pino";

const __dirname = dirname(import.meta.url);

const { PORT = 3000 } = process.env;

let server;

try {
    globalThis.logger = pino({
        redact: ['ctx.request.header.cookie', 'ctx.response.header["set-cookie"].*', 'interaction.session.cookie', 'interaction.result.siteSession.jti']
    })

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
    const kubeOperator = new KubeOIDCClientOperator(provider)
    await kubeOperator.watchClients()
} catch (err) {
    if (server?.listening) server.close();
    console.error(err);
    process.exitCode = 1;
}
