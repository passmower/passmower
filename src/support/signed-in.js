import {clientId} from "./self-oidc-client.js";

export const signedInToSelf = async (ctx, provider) => {
    const session = await provider.Session.get(ctx)
    return (!!session.accountId && !!session.authorizations[clientId]) ? session : false
}
