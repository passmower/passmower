import {clientId} from "./self-oidc-client.js";
import {validateSiteSession} from "./site-session.js";

export const signedInToSelf = async (ctx, provider) => {
    if (await validateSiteSession(ctx, clientId)) {
        const session = await provider.Session.get(ctx)
        return session.accountId ? session : false
    }
}
