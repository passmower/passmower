import Provider from "oidc-provider";
import configuration from "../support/configuration.js";
import setupPolicies from "./setup-policies.js";
import { randomUUID } from 'crypto';
import Account from "../support/account.js";
import {KubeApiService} from "./kube-api-service.js";
import renderError from "../support/render-error.js";
import loadExistingGrant from "../support/load-existing-grant.js";
import setupMiddlewares from "./setup-middlewares.js";
import RedisAdapter from "../adapters/redis.js";

export default async () => {
    let adapter;
    if (process.env.REDIS_URI) {
        adapter = RedisAdapter
    }

    const kubeApiService = new KubeApiService()
    configuration.findAccount = Account.findAccount
    configuration.interactions.policy = setupPolicies(kubeApiService)
    configuration.clients = [
        {
            client_id: 'oidc-gateway',
            client_secret: randomUUID(), // Doesn't matter as GW frontpage relies solely on cookies.
            grant_types: ['implicit'],
            response_types: ['id_token'],
            redirect_uris: [process.env.ISSUER_URL],
        }
    ]
    configuration.jwks.keys = JSON.parse(process.env.OIDC_JWKS)
    configuration.renderError = renderError
    configuration.loadExistingGrant = loadExistingGrant

    const provider = new Provider(process.env.ISSUER_URL, { adapter, ...configuration });
    provider.proxy = true
    return await setupMiddlewares(provider, kubeApiService)
}
