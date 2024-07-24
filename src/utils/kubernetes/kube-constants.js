export const metadata = 'metadata';
export const spec = 'spec';
export const OIDCUserCrd = 'OIDCUser';
export const OIDCUsers = 'oidcusers';
export const OIDCClientCrd = 'OIDCClient';
export const OIDCClients = 'oidcclients';
export const OIDCMiddlewareClientCrd = 'OIDCMiddlewareClient';
export const OIDCMiddlewareClients = 'oidcmiddlewareclients';
export const defaultApiGroup = 'codemowers.cloud'
export const defaultApiGroupVersion = 'v1beta1'
export const OIDCClientSecretName = (clientName) => `oidc-client-${clientName}-owner-secrets`
export const OIDCClientId = (namespace, clientName) => `${namespace}.${clientName}`
// Dot is chosen as the delimiting character as it is one of the few characters that is not encoded in URL and therefore avoids problematic clients that do not properly encode the client parameters for token endpoint.
// See https://github.com/panva/node-oidc-provider/blob/main/docs/README.md#my-client_secret-with-special-characters-is-not-working
export const OIDCMiddlewareClientId = (namespace, clientName) => `middleware-${namespace}.${clientName}`
export const OIDCClientSecretClientIdKey = 'OIDC_CLIENT_ID'
export const OIDCClientSecretClientSecretKey = 'OIDC_CLIENT_SECRET'
export const OIDCClientSecretGrantTypesKey = 'OIDC_GRANT_TYPES'
export const OIDCClientSecretResponseTypesKey = 'OIDC_RESPONSE_TYPES'
export const OIDCClientSecretTokenEndpointAuthMethodKey = 'OIDC_TOKEN_ENDPOINT_AUTH_METHOD'
export const OIDCClientSecretIdTokenSignedResponseAlgKey = 'OIDC_ID_TOKEN_SIGNED_RESPONSE_ALG'
export const OIDCClientSecretRedirectUrisKey = 'OIDC_REDIRECT_URIS'
export const OIDCClientSecretIdpUriKey = 'OIDC_IDP_URI'
export const OIDCClientSecretAvailableScopesKey = 'OIDC_AVAILABLE_SCOPES'
export const OIDCClientSecretAuthUriKey = 'OIDC_IDP_AUTH_URI'
export const OIDCClientSecretTokenUriKey = 'OIDC_IDP_TOKEN_URI'
export const OIDCClientSecretUserInfoUriKey = 'OIDC_IDP_USERINFO_URI'
export const OIDCClientSecretAllowedGroupsKey = 'OIDC_ALLOWED_GROUPS'
export const GitHubGroupPrefix = 'github.com'
export const TraefikMiddleware = 'Middleware'
export const TraefikMiddlewares = 'middlewares'
export const TraefikMiddlewareApiGroup = 'traefik.io'
export const TraefikMiddlewareApiGroupVersion = 'v1alpha1'
export const TraefikMiddlewareForwardAuthAddress = (deployment, namespace, clientId) => `http://${deployment}.${namespace}.svc.cluster.local:3000/forward-auth?client=${clientId}`

export const plurals = {
    [OIDCUserCrd]: OIDCUsers,
    [OIDCClientCrd]: OIDCClients,
    [OIDCMiddlewareClientCrd]: OIDCMiddlewareClients,
    [TraefikMiddleware]: TraefikMiddlewares,
}
