import Provider from "oidc-provider";
import configuration from "../configuration.js";
import setupMiddlewares from "./setup-middlewares.js";
import RedisAdapter, { getRedisUrl, waitForReady as waitForRedis } from "../adapters/redis.js";
import { initializeSelfOidcClient, withSelfOidcClient } from "../utils/session/self-oidc-client.js";
import setupEventListeners from "./setup-event-listeners.js";

export default async () => {
    let adapter;
    if (getRedisUrl()) {
        adapter = withSelfOidcClient(RedisAdapter)
        // Wait for Redis connection before proceeding
        await waitForRedis()
    }
    await initializeSelfOidcClient()
    const provider = new Provider(process.env.ISSUER_URL, { adapter, ...configuration });
    provider.proxy = true
    setupEventListeners(provider)
    return await setupMiddlewares(provider)
}
