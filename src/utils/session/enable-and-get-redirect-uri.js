import {randomUUID} from "crypto";
import RedisAdapter from "../../adapters/redis.js";

export const enableAndGetRedirectUri = async (provider, uri, clientId, responseType, scope, client) => {
    if (client) {
        const redisAdapter = new RedisAdapter('Client')
        client.redirect_uris = client.redirect_uris ?? []
        if (!client.redirect_uris.includes(uri)) {
            client.redirect_uris.push(uri)
            await redisAdapter.upsert(clientId, client)
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
