import {randomUUID} from "crypto";
import configuration from "./configuration.js";
import {
    OIDCGWClientId, OIDCGWClientSecretAuthUriKey, OIDCGWClientSecretAvailableScopesKey,
    OIDCGWClientSecretClientIdKey, OIDCGWClientSecretClientSecretKey,
    OIDCGWClientSecretGatewayUriKey, OIDCGWClientSecretGrantTypesKey,
    OIDCGWClientSecretIdTokenSignedResponseAlgKey,
    OIDCGWClientSecretName,
    OIDCGWClientSecretRedirectUrisKey,
    OIDCGWClientSecretResponseTypesKey,
    OIDCGWClientSecretTokenEndpointAuthMethodKey, OIDCGWClientSecretTokenUriKey, OIDCGWClientSecretUserInfoUriKey
} from "./kube-constants.js";

class OIDCClient {
    #clientName = null
    #clientNamespace = null
    #clientSecret = null
    #grantTypes = null
    #responseTypes = null
    #tokenEndpointAuthMethod = null
    #idTokenSignedResponseAlg = null
    #redirectUris = null
    #allowedGroups = null
    #availableScopes = null
    #gatewayUri = null
    #uri = null
    #resourceVersion = null
    #status = {
        gateway: null
    }
    #uid = null

    constructor() {
    }

    toRedis() {
        return {
            client_id: this.getClientId(),
            client_name: this.#clientName,
            client_namespace: this.#clientNamespace,
            client_secret: this.#clientSecret,
            grant_types: this.#grantTypes,
            token_endpoint_auth_method: this.#tokenEndpointAuthMethod,
            id_token_signed_response_alg: this.#idTokenSignedResponseAlg,
            response_types: this.#responseTypes,
            redirect_uris: this.#redirectUris,
            allowedGroups: this.#allowedGroups, // camel case because it's a custom metadata
            availableScopes: this.#availableScopes,
            gatewayUri: this.#gatewayUri,
            uri: this.#uri,
        }
    }

    fromIncomingClient(incomingClient) {
        this.#clientName = incomingClient.metadata.name
        this.#clientNamespace = incomingClient.metadata.namespace
        this.#grantTypes = incomingClient.spec.grantTypes
        this.#responseTypes = incomingClient.spec.responseTypes
        this.#tokenEndpointAuthMethod = incomingClient.spec.tokenEndpointAuthMethod || configuration.clientDefaults.token_endpoint_auth_method
        this.#idTokenSignedResponseAlg = incomingClient.spec.idTokenSignedResponseAlg || configuration.clientDefaults.id_token_signed_response_alg
        this.#redirectUris = incomingClient.spec.redirectUris
        this.#allowedGroups = incomingClient.spec.allowedGroups || []
        this.#availableScopes = incomingClient.spec.availableScopes
        this.#gatewayUri = process.env.ISSUER_URL
        this.#uri = incomingClient.spec.uri
        this.#resourceVersion = incomingClient.metadata.resourceVersion
        this.#status = {...this.#status, ...incomingClient.status}
        this.#uid = incomingClient.metadata.uid
        return this
    }

    toClientSecret(provider) {
        return {
            [OIDCGWClientSecretClientIdKey]: this.getClientId(),
            [OIDCGWClientSecretClientSecretKey]: this.#clientSecret,
            [OIDCGWClientSecretGrantTypesKey]: this.#grantTypes.join(','),
            [OIDCGWClientSecretResponseTypesKey]: this.#responseTypes.join(','),
            [OIDCGWClientSecretTokenEndpointAuthMethodKey]: this.#tokenEndpointAuthMethod,
            [OIDCGWClientSecretIdTokenSignedResponseAlgKey]: this.#idTokenSignedResponseAlg,
            [OIDCGWClientSecretRedirectUrisKey]: this.#redirectUris.join(','),
            [OIDCGWClientSecretGatewayUriKey]: this.#gatewayUri,
            [OIDCGWClientSecretAvailableScopesKey]: this.#availableScopes.join(','),
            [OIDCGWClientSecretAuthUriKey]: provider.urlFor('authorization'),
            [OIDCGWClientSecretTokenUriKey]: provider.urlFor('token'),
            [OIDCGWClientSecretUserInfoUriKey]: provider.urlFor('userinfo'),
        }
    }

    hasSecret() {
        return !!this.#clientSecret
    }

    generateSecret() {
        this.#clientSecret = randomUUID()
        return this
    }

    setSecret(secret) {
        this.#clientSecret = secret
        return this
    }

    getSecretName() {
        return OIDCGWClientSecretName(this.#clientName)
    }

    getUid() {
        return this.#uid
    }

    getClientId() {
        return OIDCGWClientId(this.#clientNamespace, this.#clientName)
    }

    getGateway() {
        return this.#status.gateway
    }

    getClientName() {
        return this.#clientName
    }

    getClientNamespace() {
        return this.#clientNamespace
    }

    getResourceVersion() {
        return this.#resourceVersion
    }
}

export default OIDCClient
