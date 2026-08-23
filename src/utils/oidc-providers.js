import * as client from "openid-client";

// Generic OIDC upstream providers. GitHub is intentionally NOT here — its API
// is not standards-compliant OIDC and keeps its own handler (github-login.js).
//
// Providers are fully defined at deploy time via the OIDC_PROVIDERS env var,
// which holds a JSON object keyed by provider slug:
//   { "google": { "displayName": "Google",
//      "issuer": "https://accounts.google.com", "order": 10,
//      "scopes": ["openid","email","profile"],   // optional
//      "groupsClaim": "groups",                    // optional
//      "groupPrefix": "google.com",                // optional, defaults to issuer host
//      "linkingClaims": ["tid", "oid"],             // optional stable claims retained for SCIM linking
//      "emailVerification": "oidc-claim",             // optional explicit trust opt-in
//      "tokenEndpointAuthMethod": "client_secret_post", // optional, or client_secret_basic
//      "enabled": true }}                          // optional, defaults to true
//
// Client credentials are NEVER part of that JSON — they are read from
// environment (typically a mounted Kubernetes secret) using the convention
//   <KEY>_CLIENT_ID / <KEY>_CLIENT_SECRET
// where <KEY> is the provider key upper-cased with non-alphanumerics replaced
// by underscores (e.g. key "google" -> GOOGLE_CLIENT_ID, key "entra-id" ->
// ENTRA_ID_CLIENT_ID). A provider is only surfaced when both are present.
// EMAIL_ENABLED governs outbound delivery only — email identity collection and
// downstream email claims work regardless, so the email scope is always
// requested by default. Providers that reject it can override `scopes`.
const defaultScopes = () => ['openid', 'email', 'profile'];

const envKey = (key) => key.toUpperCase().replace(/[^A-Z0-9]+/g, '_');

const defaultEmailVerification = (issuer) => {
    try {
        const url = new URL(issuer);
        if (url.protocol === 'https:' && ['accounts.google.com', 'gitlab.com'].includes(url.hostname)) {
            return 'oidc-claim';
        }
    } catch {
        // Invalid issuers are rejected by buildProvider below.
    }
    return 'none';
};

const parseProviderDefinitions = () => {
    if (!process.env.OIDC_PROVIDERS) {
        return [];
    }
    try {
        const parsed = JSON.parse(process.env.OIDC_PROVIDERS);
        if (!parsed || Array.isArray(parsed) || typeof parsed !== 'object') {
            return [];
        }
        return Object.entries(parsed)
            .filter(([, def]) => def && typeof def === 'object' && !Array.isArray(def))
            .map(([key, def]) => ({ ...def, key }))
            .sort((a, b) => {
                const aOrder = Number.isFinite(a.order) ? a.order : Number.MAX_SAFE_INTEGER;
                const bOrder = Number.isFinite(b.order) ? b.order : Number.MAX_SAFE_INTEGER;
                return aOrder - bOrder || a.key.localeCompare(b.key);
            });
    } catch (error) {
        globalThis.logger?.error({ error: error.message }, 'Failed to parse OIDC_PROVIDERS');
        return [];
    }
};

const buildProvider = (def) => {
    if (!def || !def.key || !def.issuer) {
        return null;
    }
    const prefix = envKey(def.key);
    const clientId = process.env[`${prefix}_CLIENT_ID`];
    const clientSecret = process.env[`${prefix}_CLIENT_SECRET`];
    const enabled = def.enabled !== false && !!clientId && !!clientSecret;
    let groupPrefix = def.groupPrefix;
    if (!groupPrefix) {
        try {
            groupPrefix = new URL(def.issuer).host;
        } catch {
            groupPrefix = def.key;
        }
    }
    return {
        key: def.key,
        order: Number.isFinite(def.order) ? def.order : null,
        displayName: def.displayName || def.key,
        enabled,
        issuer: def.issuer,
        clientId,
        clientSecret,
        scopes: Array.isArray(def.scopes) && def.scopes.length ? def.scopes : defaultScopes(),
        groupsClaim: def.groupsClaim || null,
        linkingClaims: Array.isArray(def.linkingClaims)
            ? [...new Set(def.linkingClaims.filter(claim => typeof claim === 'string' && /^[A-Za-z0-9_.:-]+$/.test(claim)))]
            : [],
        // Trust is a provider capability, not a generic consequence of a claim
        // named email_verified. Only issuers whose semantics we know are enabled
        // automatically; other providers require an administrator to opt in.
        emailVerification: ['oidc-claim', 'none'].includes(def.emailVerification)
            ? def.emailVerification
            : defaultEmailVerification(def.issuer),
        groupPrefix,
        // client_secret_post is the default: oauth4webapi's client_secret_basic
        // form-urlencodes credentials per RFC 6749 §2.3.1, which several major
        // providers (notably Google) do not decode — they reject the encoded
        // client_id with invalid_client "OAuth client was not found".
        tokenEndpointAuthMethod: def.tokenEndpointAuthMethod === 'client_secret_basic'
            ? 'client_secret_basic'
            : 'client_secret_post',
        // Optional custom button icon: inline SVG markup, a data: URI, or a URL.
        // Falls back to a built-in logo for well-known keys, else a generic glyph.
        icon: def.icon || null,
    };
};

// All providers that are fully configured and enabled.
export const getOidcProviders = () => parseProviderDefinitions().map(buildProvider).filter(p => p && p.enabled);

// Single enabled provider by its upstream key, or undefined.
export const getOidcProvider = (key) => getOidcProviders().find(p => p.key === key);

// Redirect URI registered with the upstream provider's OAuth application.
export const oidcRedirectUri = (key) => `${process.env.ISSUER_URL}interaction/callback/${key}`;

// Discovery is network I/O, so the configured openid-client Configuration is
// memoized per provider.
const configCache = new Map();

// Resolve a provider into an openid-client v6 `Configuration`. The client
// authentication method comes from the provider definition and defaults to
// client_secret_post — see the note on tokenEndpointAuthMethod in
// buildProvider for why basic is not the default.
export const getOidcClient = async (providerConfig) => {
    if (configCache.has(providerConfig.key)) {
        return configCache.get(providerConfig.key);
    }
    // Opt-in escape hatch for local/CI testing against an http upstream IdP
    // (e.g. a Dex container). Never enable this in production. Passing
    // allowInsecureRequests in the discovery options also relaxes the resulting
    // Configuration's token/userinfo requests.
    const options = process.env.OIDC_ALLOW_INSECURE_UPSTREAM === 'true'
        ? { execute: [client.allowInsecureRequests] }
        : undefined;
    const clientAuth = providerConfig.tokenEndpointAuthMethod === 'client_secret_basic'
        ? client.ClientSecretBasic(providerConfig.clientSecret)
        : client.ClientSecretPost(providerConfig.clientSecret);
    const config = await client.discovery(
        new URL(providerConfig.issuer),
        providerConfig.clientId,
        providerConfig.clientSecret,
        clientAuth,
        options,
    );
    configCache.set(providerConfig.key, config);
    return config;
};
