import Account from "./account.js";
import renderError from "./render-error.js";
import setupPolicies from "../implementation/setup-policies.js";

export default {
    findAccount: Account.findAccount,
    renderError,
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
            'username',
            'groups',
        ],
        profile: [
            'sub',
            'username',
            'groups',
            'email',
            'emails',
            'name',
            'profile',
        ],
        sid: null,
    },
    features: {
        devInteractions: { enabled: false }, // defaults to true
        deviceFlow: { enabled: true }, // defaults to false
        revocation: { enabled: true }, // defaults to false
        rpInitiatedLogout: { enabled: false }, // defaults to true
        introspection: {
            enabled: true, // defaults to false
            allowedPolicy: async function introspectionAllowedPolicy(ctx, client, token) {
                return !(client.clientAuthMethod === 'none' && token.clientId !== ctx.oidc.client.clientId);
            }
        },
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
        SiteSession: 3600,
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
            'kind',
            'uri',
            'displayName',
            'pkce'
        ]
    },
    pkce: {
      required: function pkceRequired(ctx, client) {
          return Boolean(client.pkce)
      }
    },
    async expiresWithSession(ctx, code) {
        return true // always end whole session, also clients using refresh token with offline_access
    },
    async issueRefreshToken(ctx, client, code) {
        return true
        // TODO: figure out why offline_access is stripped from scopes.
        // return client.grantTypeAllowed('refresh_token') && code.scopes.has('offline_access');
    },
    rotateRefreshToken(ctx) {
        // TODO: figure out how to prompt for changed conditions
        const { RefreshToken: refreshToken, Client: client } = ctx.oidc.entities;
        // cap the maximum amount of time a refresh token can be
        // rotated for up to 1 year, afterwards its TTL is final
        if (refreshToken.totalLifetime() >= 365.25 * 24 * 60 * 60) {
            return false;
        }
        // rotate non sender-constrained public client refresh tokens
        if (client.clientAuthMethod === 'none' && !refreshToken.isSenderConstrained()) {
            return true;
        }
        // rotate if the token is nearing expiration (it's beyond 70% of its lifetime)
        return refreshToken.ttlPercentagePassed() >= 70;
    }
};
