import crypto from "node:crypto";
import Account from "../support/account.js";
import {OAuth2} from "oauth";
import accessDenied from "../support/access-denied.js";
import getLoginResult from "../support/get-login-result.js";

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
        const state = `${ctx.params.uid}|${crypto.randomBytes(32).toString('hex')}`;
        await provider.interactionResult(ctx.req, ctx.res, {
            state,
        })
        ctx.status = 302;
        return ctx.redirect(ghOauth.getAuthorizeUrl({
            redirect_uri: `${process.env.ISSUER_URL}interaction/callback/gh`,
            scope: ['user:email'],
            state,
        }));
    }

    const details = await provider.interactionDetails(ctx.req, ctx.res)
    if (!details.result || details.result.state !== callbackParams.state) {
        return accessDenied(ctx, provider,'State does not match')
    }

    const token = await new Promise(resolve => {
        ghOauth.getOAuthAccessToken(callbackParams.code, {
            'redirect_uri': `${process.env.ISSUER_URL}interaction/callback/gh`,
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

    const account = await Account.createOrUpdateByEmails(ctx, emails);

    const githubProfile = {
        name: user.name,
        company: user.company,
        id: user.id,
        login: user.login,
    }
    // TODO: githubGroups
    await ctx.kubeApiService.updateUserSpec({
        accountId: account.accountId,
        githubProfile
    })

    return provider.interactionFinished(ctx.req, ctx.res, await getLoginResult(ctx, provider, account), {
        mergeWithLastSubmission: false,
    });
}
