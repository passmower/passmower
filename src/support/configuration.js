import Account from "./account.js";
import renderError from "./render-error.js";
import loadExistingGrant from "./load-existing-grant.js";
import setupPolicies from "../implementation/setup-policies.js";

export default {
    findAccount: Account.findAccount,
    renderError,
    loadExistingGrant,
    interactions: {
        url(ctx, interaction) { // eslint-disable-line no-unused-vars
            return `/interaction/${interaction.uid}`;
        },
        policy: setupPolicies()
    },
    cookies: {
        keys: JSON.parse(process.env.OIDC_COOKIE_KEYS),
        names: {
            interaction: '_interaction',
            resume: '_interaction_resume',
            session: '_session',
            admin_session: '_admin_session',
            impersonation: '_impersonation',
            site_session: '_site_session',
        }
    },
    claims: {
        acr: null,
        auth_time: null,
        iss: null,
        openid: [
            'sub',
            'groups',
        ],
        profile: [
            'sub',
            'groups',
            'email',
            'emails',
            'name',
            'company',
        ],
        sid: null,
    },
    features: {
        devInteractions: { enabled: false }, // defaults to true
        deviceFlow: { enabled: true }, // defaults to false
        revocation: { enabled: true }, // defaults to false
        rpInitiatedLogout: { enabled: false }, // defaults to true
    },
    ttl: {
        AccessToken: function AccessTokenTTL(ctx, token, client) {
            return token.resourceServer?.accessTokenTTL || 60 * 60;
        },
        AuthorizationCode: 60,
        BackchannelAuthenticationRequest: function BackchannelAuthenticationRequestTTL(ctx, request, client) {
            if (ctx?.oidc && ctx.oidc.params.requested_expiry) {
                return Math.min(10 * 60, +ctx.oidc.params.requested_expiry); // 10 minutes in seconds or requested_expiry, whichever is shorter
            }

            return 10 * 60;
        },
        ClientCredentials: function ClientCredentialsTTL(ctx, token, client) {
            return token.resourceServer?.accessTokenTTL || 10 * 60;
        },
        DeviceCode: 600,
        Grant: 1209600,
        IdToken: 3600,
        Interaction: 3600,
        RefreshToken: function RefreshTokenTTL(ctx, token, client) {
            if (
                ctx && ctx.oidc.entities.RotatedRefreshToken
                && client.applicationType === 'web'
                && client.clientAuthMethod === 'none'
                && !token.isSenderConstrained()
            ) {
                // Non-Sender Constrained SPA RefreshTokens do not have infinite expiration through rotation
                return ctx.oidc.entities.RotatedRefreshToken.remainingTTL;
            }

            return 14 * 24 * 60 * 60;
        },
        Session: 1209600,
        SiteSession: 1209600,
        AdminSession: 3600,
        Impersonation: 3600,
    },
    jwks: {
        keys: JSON.parse(process.env.OIDC_JWKS),
    },
    clientDefaults: {
        grant_types: [
            'authorization_code'
        ],
        id_token_signed_response_alg: 'RS256',
        response_types: [
            'code'
        ],
        token_endpoint_auth_method: 'client_secret_basic'
    },
    extraClientMetadata: {
        properties: [
            'allowedGroups',
            'availableScopes',
        ]
    },
};
