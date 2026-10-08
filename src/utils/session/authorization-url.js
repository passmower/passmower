import {randomUUID} from "crypto";

// An authorization request URL for one of Passmower's own clients: the
// dashboard or a forward-auth middleware client.
export const authorizationUrl = (provider, params) => {
    const url = new URL(provider.urlFor('authorization'))
    for (const [key, value] of Object.entries({nonce: randomUUID(), ...params})) {
        url.searchParams.append(key, value)
    }
    return url
}
