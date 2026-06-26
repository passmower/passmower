import * as client from "openid-client";

// Generic OIDC upstream providers. GitHub is intentionally NOT here — its API
// is not standards-compliant OIDC and keeps its own handler (github-login.js).
//
// Providers are fully defined at deploy time via the OIDC_PROVIDERS env var,
// which holds a JSON array of definitions:
//   [{ "key": "google", "displayName": "Google",
//      "issuer": "https://accounts.google.com",
//      "scopes": ["openid","email","profile"],   // optional
//      "groupsClaim": "groups",                    // optional
//      "groupPrefix": "google.com",                // optional, defaults to issuer host
//      "enabled": true }]                          // optional, defaults to true
//
// Client credentials are NEVER part of that JSON — they are read from
// environment (typically a mounted Kubernetes secret) using the convention
//   <KEY>_CLIENT_ID / <KEY>_CLIENT_SECRET
// where <KEY> is the provider key upper-cased with non-alphanumerics replaced
// by underscores (e.g. key "google" -> GOOGLE_CLIENT_ID, key "entra-id" ->
// ENTRA_ID_CLIENT_ID). A provider is only surfaced when both are present.
const DEFAULT_SCOPES = ['openid', 'email', 'profile'];

const envKey = (key) => key.toUpperCase().replace(/[^A-Z0-9]+/g, '_');

const parseProviderDefinitions = () => {
    if (!process.env.OIDC_PROVIDERS) {
        return [];
    }
    try {
        const parsed = JSON.parse(process.env.OIDC_PROVIDERS);
        return Array.isArray(parsed) ? parsed : [];
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
        displayName: def.displayName || def.key,
        enabled,
        issuer: def.issuer,
        clientId,
        clientSecret,
        scopes: Array.isArray(def.scopes) && def.scopes.length ? def.scopes : DEFAULT_SCOPES,
        groupsClaim: def.groupsClaim || null,
        groupPrefix,
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

// Resolve a provider into an openid-client v6 `Configuration`. We pin
// client_secret_basic to preserve the upstream auth method used under v5
// (`new issuer.Client(...)` defaulted to basic; v6 `discovery()` would
// otherwise default to client_secret_post).
export const getOidcClient = async (providerConfig) => {
    if (configCache.has(providerConfig.key)) {
        return configCache.get(providerConfig.key);
    }
    const config = await client.discovery(
        new URL(providerConfig.issuer),
        providerConfig.clientId,
        providerConfig.clientSecret,
        client.ClientSecretBasic(providerConfig.clientSecret),
    );
    configCache.set(providerConfig.key, config);
    return config;
};
