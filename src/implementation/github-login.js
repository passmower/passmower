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
            scope: ['user:email'],
            state,
        }));
    }

    const token = await new Promise(resolve => {
        ghOauth.getOAuthAccessToken(callbackParams.code, {
            'redirect_uri': `${process.env.ISSUER}interaction/callback/gh`,
        }, (e, access_token, refresh_token, results) => {
            resolve(access_token)
        });
    });

    const user = await fetch('https://api.github.com/user', {
        method: "GET",
        headers: {
            'Authorization': `Bearer ${token}`
        },
    }).then((r) => r.json());

    const emails = await fetch('https://api.github.com/user/emails', {
        method: "GET",
        headers: {
            'Authorization': `Bearer ${token}`
        },
    }).then((r) => r.json()).then((r) => r.map((r) => r.email));

    const account = await Account.createOrUpdateByEmails(
        ctx,
        user.login.toLowerCase(),
        emails,
        {
            name: user.name,
            company: user.company,
            githubId: user.id,
        }
        );

    const result = {
        login: {
            accountId: account.accountId,
        },
    };

    return provider.interactionFinished(ctx.req, ctx.res, result, {
        mergeWithLastSubmission: false,
    });
}
