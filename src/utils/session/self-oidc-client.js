import {randomUUID} from "crypto";

export const clientId = 'passmower'
export const responseType = 'id_token'
export const scope = 'openid'

export const buildSelfOidcClient = () => ({
    client_id: clientId,
    client_secret: randomUUID(),
    grant_types: ['implicit'],
    response_types: [responseType],
    redirect_uris: [process.env.ISSUER_URL],
    availableScopes: [scope],
    kind: 'SelfOIDCClient'
})
