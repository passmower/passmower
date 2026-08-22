import * as client from "openid-client";
import Account from "../../models/account.js";
import accessDenied from "../../utils/session/access-denied.js";
import getLoginResult from "../../utils/user/get-login-result.js";
import { auditLog } from "../../utils/session/audit-log.js";
import { getOidcClient, oidcRedirectUri } from "../../utils/oidc-providers.js";
import ScimLinkService from "../scim-link-service.js";
import {isEmailEnabled} from '../../utils/email-configuration.js';
import {canonicalizeEmail} from '../../utils/user/identity-integrity.js';

// An explicit upstream `email_verified: false` is heeded from every issuer,
// trusted or not: a negative signal can only deny email-based account linking,
// never grant it, so acting on it is always safe. The per-provider
// emailVerification setting governs only whether `true` is trusted.
export const getOidcEmailError = (profile, env = process.env) => {
    if (!profile.email && isEmailEnabled(env)) return 'missing'
    if (profile.email && profile.email_verified === false) return 'unverified'
    return null
}

// Map the validated id_token / userinfo claims onto the structure we persist
// under identities.<provider> and the values createOrUpdateByEmails expects.
export const extractIdentity = (providerConfig, profile, observedAt = new Date().toISOString()) => {
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
        emails: primaryEmail ? [{
            email: primaryEmail,
            primary: true,
            verified: providerConfig.emailVerification === 'oidc-claim'
                && typeof profile.email_verified === 'boolean' ? profile.email_verified : undefined,
            observedAt,
        }] : [],
        groups,
        preferredUsername: profile.preferred_username ?? profile.nickname,
        linkClaims: Object.fromEntries(providerConfig.linkingClaims
            .filter(claim => ['string', 'number'].includes(typeof profile[claim]))
            .map(claim => [claim, String(profile[claim])])),
    };
};

// PASSMOWER_VERIFIED_EMAIL_OVERRIDE relaxes the explicit-false login error for
// returning users only: the upstream identity (provider + sub) must already be
// linked to an account, and that account must hold durable magic-link evidence
// for the exact address. First-time email-based linking still requires the
// upstream signal, so a stranger holding the address unverified upstream cannot
// ride the victim's own Passmower verification into their account.
export const shouldOverrideUnverifiedEmail = async (ctx, providerKey, sub, email, env = process.env) => {
    if (env.PASSMOWER_VERIFIED_EMAIL_OVERRIDE !== 'true') return false
    const address = canonicalizeEmail(email)
    if (!address || !sub) return false
    let account
    try {
        account = await ctx.kubeOIDCUserService.findUserByIdentity(providerKey, sub)
    } catch {
        // Identity conflicts and lookup failures fail closed; phase 3 linking
        // surfaces and audits the underlying integrity problem.
        return false
    }
    if (!account) return false
    return account.getEmailVerifications().some(item =>
        item.email === address && item.method === 'magic-link' && item.status === 'verified')
}

// UserInfo may replace the ID-token email. Only carry ID-token verification
// across when both responses identify the same normalized address. When the
// two validated responses disagree about verification, fail closed.
export const mergeOidcProfile = (claims = {}, userinfo = {}) => {
    const profile = {...claims, ...userinfo};
    const selectedEmail = canonicalizeEmail(profile.email);
    const matchingSignals = [claims, userinfo]
        .filter(source => canonicalizeEmail(source.email) === selectedEmail)
        .map(source => source.email_verified)
        .filter(value => typeof value === 'boolean');
    if (matchingSignals.includes(false)) profile.email_verified = false;
    else if (matchingSignals.includes(true)) profile.email_verified = true;
    else delete profile.email_verified;
    return profile;
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
            // openid-client error classes carry the OAuth error body/params
            // (ResponseBodyError from the token endpoint, AuthorizationResponseError
            // from an error= callback) — surface them, error.message alone is generic.
            auditLog(ctx, {
                error: error.message,
                oauthError: error.error,
                oauthErrorDescription: error.error_description,
                cause: error.cause,
                interactionDetails,
            }, `Error getting tokens from ${displayName}`);
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
        const profile = mergeOidcProfile(claims, userinfo);

        const emailError = getOidcEmailError(profile)
        if (emailError === 'missing') {
            auditLog(ctx, { error: true, interactionDetails }, `No email returned from ${displayName}`);
            return accessDenied(ctx, provider, `No email returned from ${displayName}`);
        }
        if (emailError === 'unverified') {
            if (await shouldOverrideUnverifiedEmail(ctx, key, profile.sub, profile.email)) {
                auditLog(ctx, { interactionDetails }, `Accepting upstream-unverified email from ${displayName}: address is Passmower-verified for the already-linked account`);
            } else {
                auditLog(ctx, { error: true, interactionDetails }, `Email not verified by ${displayName}`);
                const remediation = isEmailEnabled()
                    ? `Verify ${profile.email} at ${displayName} and sign in again, or use email login to verify it with Passmower.`
                    : `Verify ${profile.email} at ${displayName} and sign in again.`;
                return accessDenied(ctx, provider, `Email not verified by ${displayName}. ${remediation}`);
            }
        }

        identity = extractIdentity(providerConfig, profile);
        await provider.interactionResult(ctx.req, ctx.res, {
            oidc: { provider: key, identity },
        });
    }

    // Phase 3 — link/create the account, persist the identity, finish.
    const account = await Account.createOrUpdateByEmails(
        ctx, provider, identity.primaryEmail, identity.emails, undefined, identity.preferredUsername,
        {providerKey: key, subject: identity.sub}
    );

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
                        linkClaims: identity.linkClaims,
                    },
                },
            }
        );
        try {
            await new ScimLinkService(
                ctx.kubeOIDCUserService.adapter,
                ctx.kubeOIDCUserService,
            ).linkAccount(key, account.accountId, identity.linkClaims);
        } catch (error) {
            // Linking enriches authorization; it is not authentication. Fail
            // closed for the SCIM grant while allowing the verified upstream
            // login to finish, and leave an audit trail for reconciliation.
            auditLog(ctx, {error: error.message, provider: key, accountId: account.accountId}, 'SCIM account linking failed');
        }
    }

    return provider.interactionFinished(ctx.req, ctx.res, await getLoginResult(ctx, provider, account, displayName), {
        mergeWithLastSubmission: false,
    });
};
