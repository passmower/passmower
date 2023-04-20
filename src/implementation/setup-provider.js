import Provider from "oidc-provider";
import configuration from "../support/configuration.js";
import setupPolicies from "./setup-policies.js";
import Account from "../support/account.js";
import {KubeApiService} from "./kube-api-service.js";
import renderError from "../support/render-error.js";
import loadExistingGrant from "../support/load-existing-grant.js";
import setupMiddlewares from "./setup-middlewares.js";
import RedisAdapter from "../adapters/redis.js";
import selfOidcClient from "../support/self-oidc-client.js";

export default async () => {
    let adapter;
    if (process.env.REDIS_URI) {
        adapter = RedisAdapter
    }

    const kubeApiService = new KubeApiService()
    configuration.findAccount = Account.findAccount
    configuration.interactions.policy = setupPolicies(kubeApiService)
    configuration.clients = [selfOidcClient]
    configuration.jwks.keys = JSON.parse(process.env.OIDC_JWKS)
    configuration.renderError = renderError
    configuration.loadExistingGrant = loadExistingGrant

    const provider = new Provider(process.env.ISSUER_URL, { adapter, ...configuration });
    provider.proxy = true
    return await setupMiddlewares(provider, kubeApiService)
}
