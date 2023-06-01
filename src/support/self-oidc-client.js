import {randomUUID} from "crypto";
import RedisAdapter from "../adapters/redis.js";
import {getUrlsInProviderBaseDomain} from "./base-domain.js";

export const clientId = 'oidc-gateway'
export const responseType = 'id_token'
export const scope = 'openid'

const baseClient = {
    client_id: clientId,
    client_secret: randomUUID(), // Doesn't matter as GW frontpage relies solely on cookies.
    grant_types: [ 'implicit' ],
    response_types: [ responseType ],
    availableScopes: [ scope ],
}

export const initializeSelfOidcClient = async () => {
    const redis = new RedisAdapter('Client')
    const client = await redis.find(clientId)
    baseClient.redirect_uris = validateUris(client?.redirect_uris ?? []) // Validate that existing URLs do not have prohibited values
    await redis.upsert(clientId, baseClient)
}

const validateUris = (uris) => {
    const filteredUris = [
        ...getUrlsInProviderBaseDomain(uris),
        process.env.ISSUER_URL
    ]
    return Array.from(new Set(filteredUris))
}
