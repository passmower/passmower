import {randomUUID} from "crypto";
import RedisAdapter from "../adapters/redis.js";
import {getUrlsInProviderBaseDomain} from "./base-domain.js";

export const clientId = 'oidc-gateway'
const responseType = 'id_token'
const scope = 'openid'

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

export const enableAndGetRedirectUri = async (provider, uri) => {
    if (uri !== process.env.ISSUER_URL) {
        // The custom URL is already expected to be validated beforehand
        const redis = new RedisAdapter('Client')
        const client = await redis.find(clientId)
        client.redirect_uris = client.redirect_uris ?? []
        if (!client.redirect_uris.includes(uri)) {
            client.redirect_uris.push(uri)
            await redis.upsert(clientId, client)
        }
    }

    const url = new URL(provider.urlFor('authorization'))
    url.searchParams.append('client_id', clientId)
    url.searchParams.append('response_type', responseType)
    url.searchParams.append('scope', scope)
    url.searchParams.append('nonce', randomUUID())
    url.searchParams.append('redirect_uri', uri)
    return url
}
