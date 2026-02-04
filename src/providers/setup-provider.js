import Provider from "oidc-provider";
import configuration from "../configuration.js";
import setupMiddlewares from "./setup-middlewares.js";
import RedisAdapter, { waitForReady as waitForRedis } from "../adapters/redis.js";
import { initializeSelfOidcClient } from "../utils/session/self-oidc-client.js";
import setupEventListeners from "./setup-event-listeners.js";

export default async () => {
    let adapter;
    if (process.env.REDIS_URI) {
        adapter = RedisAdapter
        // Wait for Redis connection before proceeding
        await waitForRedis()
    }
    await initializeSelfOidcClient()
    const provider = new Provider(process.env.ISSUER_URL, { adapter, ...configuration });
    provider.proxy = true
    setupEventListeners(provider)
    return await setupMiddlewares(provider)
}
