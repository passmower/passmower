import Provider from "oidc-provider";
import configuration from "../support/configuration.js";
import setupMiddlewares from "./setup-middlewares.js";
import RedisAdapter from "../adapters/redis.js";
import { initializeSelfOidcClient } from "../support/self-oidc-client.js";
import setupEventListeners from "./setup-event-listeners.js";

export default async () => {
    let adapter;
    if (process.env.REDIS_URI) {
        adapter = RedisAdapter
    }
    await initializeSelfOidcClient()
    const provider = new Provider(process.env.ISSUER_URL, { adapter, ...configuration });
    provider.proxy = true
    setupEventListeners(provider)
    return await setupMiddlewares(provider)
}
