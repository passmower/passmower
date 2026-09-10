import Account from "./models/account.js";
import renderError from "./utils/render-error.js";
import setupPolicies from "./providers/setup-policies.js";
import {errors} from "oidc-provider";
import isOrigin from "./utils/session/is-origin.js";
import {fetchExtraClaims} from "./utils/fetch-extra-claims.js";
import {mappedClaimsFor} from "./utils/claim-mappings.js";
import {getAccountAccessFailure} from './utils/user/check-account-access.js';
import {auditLog} from './utils/session/audit-log.js';

export default {
    async findAccount(ctx, id, token) {
        const account = await Account.findAccount(ctx, id, token)
        if (token?.kind === 'RefreshToken') {
            const failure = getAccountAccessFailure(ctx.oidc?.client, account)
            if (failure) {
                auditLog(ctx, {accountId: id, clientId: ctx.oidc?.client?.clientId, failure},
                    'Refresh token no longer satisfies account access policy')
                // undefined, not null: oidc-provider validates this callback's
                // return (helpers/configuration_result.js) and accepts only
                // undefined or a well-formed account — null is a TypeError, and
                // a 500 where the client should get invalid_grant.
                return undefined
            }
        }
        return account
    },
    renderError,
    interactions: {
        url(ctx, interaction) { // eslint-disable-line no-unused-vars
            return `/interaction/${interaction.uid}`;
        },
        policy: setupPolicies()
    },
    conformIdTokenClaims: false, // https://github.com/panva/node-oidc-provider/blob/main/docs/README.md#id-token-does-not-include-claims-other-than-sub
    // Include the user's groups (and, via the enrichment webhook, namespaces)
    // in JWT access tokens when the matching scope was granted, so resource
    // servers can authorize without an extra userinfo call. Only applies to
    // self-contained (JWT) access tokens; see features.resourceIndicators.
    async extraTokenClaims(ctx, token) {
        if (token.kind !== 'AccessToken') {
            return undefined;
        }
        const scopes = token.scope ? token.scope.split(' ') : [];
        const wantsGroups = scopes.includes('groups');
        const wantsNamespaces = scopes.includes('namespaces');
        // Mapped claims are bound to the openid scope rather than requested, so
        // they apply to any access token this client is issued.
        const client = ctx?.oidc?.client?.clientId === token.clientId
            ? ctx.oidc.client
            : await ctx?.oidc?.provider?.Client?.find(token.clientId);
        const hasClaimMappings = !!Object.keys(client?.claimMappings ?? {}).length;
        if (!wantsGroups && !wantsNamespaces && !hasClaimMappings) {
            return undefined;
        }
        const account = await Account.findAccount(ctx, token.accountId);
        if (!account) {
            return undefined;
        }
        const groups = (account.groups || []).map(g => `${g.prefix}:${g.name}`);
        const claims = {};
        if (wantsGroups) {
            claims.groups = groups;
        }
        // Small, stable external signals (e.g. namespaces from the billing
        // service). Fail-open: fetchExtraClaims returns {} on any error.
        if (wantsNamespaces) {
            Object.assign(claims, await fetchExtraClaims({
                sub: token.accountId,
                groups,
                client_id: token.clientId,
                scope: token.scope,
            }));
        }
        Object.assign(claims, mappedClaimsFor(ctx?.oidc?.provider, client, groups));
        return Object.keys(claims).length ? claims : undefined;
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
        ],
        profile: [
            'emails',
            'name',
            'nickname',
            'profile',
        ],
        email: ['email', 'email_verified'],
        groups: ['groups'],
        allowed_groups: ['groups'],
        applications: ['applications'],
        // Kubernetes namespaces the caller may access, supplied by the
        // external enrichment webhook (EXTRA_CLAIMS_WEBHOOK_URL). The prefixed
        // claim key follows the same domain convention as the label schema
        // downstream resource servers filter by.
        namespaces: ['codemowers.io/namespaces'],
        sid: null,
    },
    // Scopes not backed by a claim. `all_applications` gates the admin-only
    // catalog endpoint; the apps list itself is delivered via REST, not a claim.
    scopes: ['openid', 'offline_access', 'all_applications', 'namespaces'],
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
        // RFC 8707 Resource Indicators. When a client requests a `resource`,
        // the issued access token is a self-contained JWT (audience-bound to
        // that resource) instead of an opaque reference, so resource servers
        // can validate it against the JWKS endpoint without introspection.
        // Clients that do not request a resource keep getting opaque tokens.
        resourceIndicators: {
            enabled: true,
            // Use the resource granted at authorization even when the token
            // request omits an explicit `resource` parameter.
            useGrantedResource: () => true,
            getResourceServerInfo(ctx, resourceIndicator, client) {
                return {
                    audience: resourceIndicator,
                    accessTokenTTL: 60 * 60,
                    accessTokenFormat: 'jwt',
                    // Scope the resource server to whatever the client may
                    // request; keeps this generic with no app-specific config.
                    scope: (client.availableScopes || ['openid', 'profile', 'groups', 'offline_access']).join(' '),
                    jwt: {
                        sign: { alg: 'RS256' },
                    },
                };
            },
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
        token_endpoint_auth_method: 'client_secret_basic',
        // 'web' (default) requires https redirect URIs. Native/mobile apps
        // (custom-scheme or http loopback redirect URIs, e.g. immich, the
        // Nextcloud Android app) must set application_type: 'native'.
        application_type: 'web'
    },
    extraClientMetadata: {
        properties: [
            'allowedGroups',
            'allowedUsers',
            'claimMappings',
            'clientNamespace',
            'availableScopes',
            'kind',
            'uri',
            'displayName',
            'pkce',
            'overrideIncomingScopes',
            'allowedCORSOrigins'
        ],
        validator(ctx, key, value, metadata) {
            // Unlisted metadata is stripped by oidc-provider, and a client
            // predating the field has none — normalise so the emission paths
            // can read client.claimMappings without guarding.
            if (key === 'claimMappings' && (value === undefined || value === null)) {
                metadata['claimMappings'] = {};
                return;
            }
            if (key === 'allowedCORSOrigins') {
                // set default (no CORS)
                if (value === undefined) {
                    metadata['allowedCORSOrigins'] = [];
                    return;
                }
                // validate an array of Origin strings
                if (!Array.isArray(value) || !value.every(isOrigin)) {
                    throw new errors.InvalidClientMetadata(`allowedCORSOrigins must be an array of origins`);
                }
            }
        },
    },
    clientBasedCORS(ctx, origin, client) {
        // https://github.com/panva/node-oidc-provider/blob/main/recipes/client_based_origins.md
        // ctx.oidc.route can be used to exclude endpoints from this behaviour, in that case just return
        // true to always allow CORS on them, false to deny
        // you may also allow some known internal origins if you want to
        return client.allowedCORSOrigins.includes(origin);
    },
    pkce: {
      required: function pkceRequired(ctx, client) {
          return Boolean(client.pkce)
      }
    },
    async expiresWithSession(ctx, code) {
        return true // always end whole session, also clients using refresh token with offline_access
    },
    // Refresh tokens go to any client allowed the refresh_token grant, whether
    // or not offline_access was granted. oidc-provider's default additionally
    // requires that scope, which OIDC Core §11 ties to prompt=consent — but
    // these are not offline access: expiresWithSession above ends them with the
    // session, so they only ever renew silently while the user is still signed
    // in. Requiring the consent ceremony for that would buy nothing and take
    // renewal away from every client whose relying party does not send the
    // prompt. A relying party that wants true offline access requests
    // offline_access with prompt=consent, and gets a grant carrying the scope.
    //
    // The grant-type half is not optional: without it a client is handed a
    // refresh token the token endpoint then refuses with "requested grant type
    // is not allowed for this client".
    async issueRefreshToken(ctx, client, code) { // eslint-disable-line no-unused-vars
        if (client.grantTypeAllowed('refresh_token')) {
            return true
        }
        // Asked for offline access but cannot be given it — a client whose
        // grantTypes and whose application disagree, which is otherwise silent:
        // sign-in succeeds and only renewal is missing.
        if ((ctx.oidc?.params?.scope ?? '').split(' ').includes('offline_access')) {
            auditLog(ctx, {clientId: client.clientId},
                'Refresh token withheld: client is not allowed the refresh_token grant')
        }
        return false
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
