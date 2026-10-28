import Provider from "oidc-provider";
import configuration from "../configuration.js";
import setupMiddlewares from "./setup-middlewares.js";
import RedisAdapter, { getRedisUrl, waitForReady as waitForRedis } from "../adapters/redis.js";
import { buildSelfOidcClient, clientId as selfClientId } from "../utils/session/self-oidc-client.js";
import setupEventListeners from "./setup-event-listeners.js";

export default async () => {
    let adapter;
    if (getRedisUrl()) {
        adapter = RedisAdapter
        // Wait for Redis connection before proceeding
        await waitForRedis()
        // The self client is static configuration, which oidc-provider never
        // reads from the adapter. Drop the record older versions stored in Redis.
        await new RedisAdapter('Client').destroy(selfClientId)
    }
    const provider = new Provider(process.env.ISSUER_URL, { adapter, ...configuration, clients: [buildSelfOidcClient()] });
    provider.proxy = true
    setupEventListeners(provider)
    return await setupMiddlewares(provider)
}
