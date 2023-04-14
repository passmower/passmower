export const OIDCGWUser = 'OIDCGWUser';
export const OIDCGWUsers = 'oidcgatewayusers';
export const OIDCGWUserSpecProfileKey = 'profile';
export const OIDCGWUserSpecAcceptedTosKey = 'acceptedTos';
export const OIDCGWUserSpecGroupsKey = 'groups';
export const OIDCGWUserSpecEmailsKey = 'emails';
export const OIDCGWClients = 'oidcgatewayclients';
export const apiGroup = 'codemowers.io'
export const apiGroupVersion = 'v1alpha1'
export const OIDCGWClientSecretName = (clientName) => `oidc-client-${clientName}-owner-secrets`
export const OIDCGWClientId = (namespace, clientName) => `${namespace}-${clientName}`
export const OIDCGWClientSecretClientIdKey = 'OIDC_CLIENT_ID'
export const OIDCGWClientSecretClientSecretKey = 'OIDC_CLIENT_SECRET'
export const OIDCGWClientSecretGrantTypesKey = 'OIDC_GRANT_TYPES'
export const OIDCGWClientSecretResponseTypesKey = 'OIDC_RESPONSE_TYPES'
export const OIDCGWClientSecretTokenEndpointAuthMethodKey = 'OIDC_TOKEN_ENDPOINT_AUTH_METHOD'
export const OIDCGWClientSecretIdTokenSignedResponseAlgKey = 'OIDC_ID_TOKEN_SIGNED_RESPONSE_ALG'
export const OIDCGWClientSecretRedirectUrisKey = 'OIDC_REDIRECT_URIS'
export const OIDCGWClientSecretGatewayUriKey = 'OIDC_GATEWAY_URI'
