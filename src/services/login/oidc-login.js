import * as client from "openid-client";
import Account from "../../models/account.js";
import accessDenied from "../../utils/session/access-denied.js";
import getLoginResult from "../../utils/user/get-login-result.js";
import { auditLog } from "../../utils/session/audit-log.js";
import { getOidcClient, oidcRedirectUri } from "../../utils/oidc-providers.js";

// Map the validated id_token / userinfo claims onto the structure we persist
// under identities.<provider> and the values createOrUpdateByEmails expects.
const extractIdentity = (providerConfig, profile) => {
    const primaryEmail = profile.email;
    let groups = [];
    if (providerConfig.groupsClaim && Array.isArray(profile[providerConfig.groupsClaim])) {
        groups = profile[providerConfig.groupsClaim].map(name => ({
            prefix: providerConfig.groupPrefix,
            name: String(name),
        }));
    }
    return {
        sub: profile.sub,
        name: profile.name ?? null,
        company: null,
        primaryEmail,
        emails: [{ email: primaryEmail, primary: true }],
        groups,
        preferredUsername: profile.preferred_username ?? profile.nickname,
    };
};

// Generic OpenID Connect upstream login. Handles any standards-compliant
// provider from the registry (Google, GitLab, EntraID, …). Mirrors the
// three-phase shape of github-login.js: redirect → callback → link & finish.
export default async (ctx, provider, providerConfig) => {
    const { key, displayName } = providerConfig;
    const redirectUri = oidcRedirectUri(key);

    const callbackParams = { ...ctx.request.body };
    delete callbackParams['upstream'];

    const interactionDetails = await provider.interactionDetails(ctx.req, ctx.res);

    // Resume after custom-username creation: the identity was already extracted
    // and stashed in the interaction result, so we can skip the provider round-trip.
    let identity = interactionDetails?.lastSubmission?.oidc?.identity;

    // Phase 1 — start the authorization-code flow.
    if (!identity && !Object.keys(callbackParams).length) {
        const config = await getOidcClient(providerConfig);
        const codeVerifier = client.randomPKCECodeVerifier();
        const codeChallenge = await client.calculatePKCECodeChallenge(codeVerifier);
        const nonce = client.randomNonce();
        // Keep the `uid|random` state shape so repost.ejs can recover the uid.
        const state = `${ctx.params.uid}|${client.randomState()}`;
        await provider.interactionResult(ctx.req, ctx.res, {
            oidcFlow: { provider: key, state, codeVerifier, nonce },
        });
        ctx.status = 302;
        auditLog(ctx, { interactionDetails, state }, `Redirecting user to ${displayName}`);
        return ctx.redirect(client.buildAuthorizationUrl(config, {
            redirect_uri: redirectUri,
            scope: providerConfig.scopes.join(' '),
            state,
            nonce,
            code_challenge: codeChallenge,
            code_challenge_method: 'S256',
        }).href);
    }

    // Phase 2 — handle the callback: validate state, exchange the code (PKCE),
    // validate the id_token (nonce/JWKS) and read the profile.
    if (!identity) {
        const flow = interactionDetails?.result?.oidcFlow || interactionDetails?.lastSubmission?.oidcFlow;
        if (!flow || flow.provider !== key || flow.state !== callbackParams.state) {
            auditLog(ctx, { error: true, interactionDetails }, 'State does not match');
            return accessDenied(ctx, provider, 'State does not match');
        }

        const config = await getOidcClient(providerConfig);
        // v6 reads the callback parameters from a full URL; reconstruct it from
        // the registered redirect URI plus the posted-back query parameters.
        const callbackUrl = new URL(redirectUri);
        for (const [param, value] of Object.entries(callbackParams)) {
            if (value !== undefined && value !== null) {
                callbackUrl.searchParams.set(param, String(value));
            }
        }
        let tokenSet;
        try {
            tokenSet = await client.authorizationCodeGrant(config, callbackUrl, {
                expectedState: flow.state,
                pkceCodeVerifier: flow.codeVerifier,
                expectedNonce: flow.nonce,
            });
        } catch (error) {
            auditLog(ctx, { error: error.message, interactionDetails }, `Error getting tokens from ${displayName}`);
            return accessDenied(ctx, provider, 'User aborted login');
        }

        const claims = tokenSet.claims() ?? {};
        let userinfo = {};
        try {
            userinfo = await client.fetchUserInfo(config, tokenSet.access_token, claims.sub);
        } catch (error) {
            // userinfo is best-effort — the id_token already carries sub/email.
            auditLog(ctx, { error: error.message, interactionDetails }, `Error getting userinfo from ${displayName}`);
        }
        const profile = { ...claims, ...userinfo };

        if (!profile.email) {
            auditLog(ctx, { error: true, interactionDetails }, `No email returned from ${displayName}`);
            return accessDenied(ctx, provider, `No email returned from ${displayName}`);
        }
        if (profile.email_verified === false) {
            auditLog(ctx, { error: true, interactionDetails }, `Email not verified by ${displayName}`);
            return accessDenied(ctx, provider, `Email not verified by ${displayName}`);
        }

        identity = extractIdentity(providerConfig, profile);
        await provider.interactionResult(ctx.req, ctx.res, {
            oidc: { provider: key, identity },
        });
    }

    // Phase 3 — link/create the account, persist the identity, finish.
    const account = await Account.createOrUpdateByEmails(ctx, provider, identity.primaryEmail, identity.emails, undefined, identity.preferredUsername);

    if (!account?.accountId) {
        auditLog(ctx, { account, interactionDetails }, `Unable to determine account from ${displayName}`);
    } else {
        await ctx.kubeOIDCUserService.updateUserSpecs(
            account.accountId,
            {
                identities: {
                    [key]: {
                        sub: identity.sub,
                        name: identity.name,
                        company: identity.company,
                        emails: identity.emails,
                        groups: identity.groups,
                    },
                },
            }
        );
    }

    return provider.interactionFinished(ctx.req, ctx.res, await getLoginResult(ctx, provider, account, displayName), {
        mergeWithLastSubmission: false,
    });
};
