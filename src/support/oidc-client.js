import {randomUUID} from "crypto";
import configuration from "./configuration.js";
import {
    OIDCGWClientId,
    OIDCGWClientSecretClientIdKey, OIDCGWClientSecretClientSecretKey,
    OIDCGWClientSecretGatewayUriKey, OIDCGWClientSecretGrantTypesKey,
    OIDCGWClientSecretIdTokenSignedResponseAlgKey,
    OIDCGWClientSecretName,
    OIDCGWClientSecretRedirectUrisKey,
    OIDCGWClientSecretResponseTypesKey,
    OIDCGWClientSecretTokenEndpointAuthMethodKey
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
    #gatewayUri = null
    #resourceVersion = null
    #status = {
        gateway: null
    }

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
            gateway_uri: this.#gatewayUri
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
        this.#gatewayUri = process.env.ISSUER_URL
        this.#resourceVersion = incomingClient.metadata.resourceVersion
        this.#status = {...this.#status, ...incomingClient.status}
        return this
    }

    toClientSecret() {
        // TODO: provide available scopes etc.
        return {
            [OIDCGWClientSecretClientIdKey]: this.getClientId(),
            [OIDCGWClientSecretClientSecretKey]: this.#clientSecret,
            [OIDCGWClientSecretGrantTypesKey]: this.#grantTypes,
            [OIDCGWClientSecretResponseTypesKey]: this.#responseTypes,
            [OIDCGWClientSecretTokenEndpointAuthMethodKey]: this.#tokenEndpointAuthMethod,
            [OIDCGWClientSecretIdTokenSignedResponseAlgKey]: this.#idTokenSignedResponseAlg,
            [OIDCGWClientSecretRedirectUrisKey]: this.#redirectUris,
            [OIDCGWClientSecretGatewayUriKey]: this.#gatewayUri
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
