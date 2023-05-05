import {randomUUID} from "crypto";

export const responseType = 'id_token'
export const scope = 'openid'

export default {
    client_id: 'oidc-gateway',
    client_secret: randomUUID(), // Doesn't matter as GW frontpage relies solely on cookies.
    grant_types: ['implicit'],
    response_types: [responseType],
    redirect_uris: [process.env.ISSUER_URL],
    availableScopes: [ 'openid' ],
}
