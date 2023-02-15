import crypto from "node:crypto";
import Account from "../support/account.js";
import {OAuth2} from "oauth";

export default async (ctx, provider) => {
    const ghOauth = new OAuth2(process.env.GH_CLIENT_ID,
        process.env.GH_CLIENT_SECRET,
        'https://github.com/',
        'login/oauth/authorize',
        'login/oauth/access_token',
        null);

    const callbackParams = ctx.request.body
    delete callbackParams['upstream']

    if (!Object.keys(callbackParams).length) {
        const state = `${ctx.params.uid}|${crypto.randomBytes(32).toString('hex')}`; // TODO: how is state used later on?
        ctx.status = 302;
        return ctx.redirect(ghOauth.getAuthorizeUrl({
            redirect_uri: `${process.env.ISSUER}interaction/callback/gh`,
            state,
        }));
    }

    const token = await new Promise(resolve => {
        ghOauth.getOAuthAccessToken(callbackParams.code, {'redirect_uri': `${process.env.ISSUER}interaction/callback/gh`}, (e, access_token, refresh_token, results) => {
            resolve(access_token)
        });
    });

    const user = await fetch('https://api.github.com/user', {
        method: "GET",
        headers: {
            'Authorization': `Bearer ${token}`
        },
    }).then((r) => r.json());

    const account = await Account.findByFederated('gh', {
        sub: user.id
    });

    const result = {
        login: {
            accountId: account.accountId,
        },
    };

    return provider.interactionFinished(ctx.req, ctx.res, result, {
        mergeWithLastSubmission: false,
    });
}
