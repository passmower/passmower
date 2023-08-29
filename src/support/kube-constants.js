export const metadata = 'metadata';
export const spec = 'spec';
export const OIDCGWUser = 'OIDCGWUser';
export const OIDCGWUsers = 'oidcgatewayusers';
export const OIDCGWClient = 'OIDCGWClient';
export const OIDCGWClients = 'oidcgatewayclients';
export const OIDCGWMiddlewareClient = 'OIDCGWMiddlewareClient';
export const OIDCGWMiddlewareClients = 'oidcgatewaymiddlewareclients';
export const defaultApiGroup = 'codemowers.io'
export const defaultApiGroupVersion = 'v1alpha1'
export const OIDCGWClientSecretName = (clientName) => `oidc-client-${clientName}-owner-secrets`
export const OIDCGWClientId = (namespace, clientName) => `${namespace}.${clientName}`
// Dot is chosen as the delimiting character as it is one of the few characters that is not encoded in URL and therefore avoids problematic clients that do not properly encode the client parameters for token endpoint.
// See https://github.com/panva/node-oidc-provider/blob/main/docs/README.md#my-client_secret-with-special-characters-is-not-working
export const OIDCGWMiddlewareClientId = (namespace, clientName) => `middleware-${namespace}.${clientName}`
export const OIDCGWClientSecretClientIdKey = 'OIDC_CLIENT_ID'
export const OIDCGWClientSecretClientSecretKey = 'OIDC_CLIENT_SECRET'
export const OIDCGWClientSecretGrantTypesKey = 'OIDC_GRANT_TYPES'
export const OIDCGWClientSecretResponseTypesKey = 'OIDC_RESPONSE_TYPES'
export const OIDCGWClientSecretTokenEndpointAuthMethodKey = 'OIDC_TOKEN_ENDPOINT_AUTH_METHOD'
export const OIDCGWClientSecretIdTokenSignedResponseAlgKey = 'OIDC_ID_TOKEN_SIGNED_RESPONSE_ALG'
export const OIDCGWClientSecretRedirectUrisKey = 'OIDC_REDIRECT_URIS'
export const OIDCGWClientSecretGatewayUriKey = 'OIDC_GATEWAY_URI'
export const OIDCGWClientSecretAvailableScopesKey = 'OIDC_AVAILABLE_SCOPES'
export const OIDCGWClientSecretAuthUriKey = 'OIDC_GATEWAY_AUTH_URI'
export const OIDCGWClientSecretTokenUriKey = 'OIDC_GATEWAY_TOKEN_URI'
export const OIDCGWClientSecretUserInfoUriKey = 'OIDC_GATEWAY_USERINFO_URI'
export const GitHubGroupPrefix = 'github.com'
export const TraefikMiddleware = 'Middleware'
export const TraefikMiddlewares = 'middlewares'
export const TraefikMiddlewareApiGroup = 'traefik.containo.us'
export const TraefikMiddlewareApiGroupVersion = 'v1alpha1'
export const TraefikMiddlewareForwardAuthAddress = (deployment, namespace, clientId) => `http://${deployment}.${namespace}.svc.cluster.local:3000/forward-auth?client=${clientId}`

export const plurals = {
    [OIDCGWUser]: OIDCGWUsers,
    [OIDCGWClient]: OIDCGWClients,
    [OIDCGWMiddlewareClient]: OIDCGWMiddlewareClients,
    [TraefikMiddleware]: TraefikMiddlewares,
}
