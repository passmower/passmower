import {randomUUID} from "crypto";
import configuration from "./configuration.js";

class OIDCClient {
    #clientName = null
    #clientNamespace = null
    #clientSecret = null
    #grantTypes = null
    #responseTypes = null
    #tokenEndpointAuthMethod = null
    #idTokenSignedResponseAlg = null
    #redirectUris = null
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
            gateway_uri: this.#gatewayUri
        }
    }

    fromIncomingClient(incomingClient) {
        this.#clientName = incomingClient.metadata.name
        this.#clientNamespace = incomingClient.metadata.namespace
        this.#grantTypes = incomingClient.grantTypes
        this.#responseTypes = incomingClient.responseTypes
        this.#tokenEndpointAuthMethod = incomingClient.tokenEndpointAuthMethod || configuration.clientDefaults.token_endpoint_auth_method
        this.#idTokenSignedResponseAlg = incomingClient.idTokenSignedResponseAlg || configuration.clientDefaults.id_token_signed_response_alg
        this.#redirectUris = incomingClient.redirectUris
        this.#gatewayUri = process.env.ISSUER_URL
        this.#resourceVersion = incomingClient.metadata.resourceVersion
        this.#status = {...this.#status, ...incomingClient.status}
        return this
    }

    toClientSecret() {
        // TODO: provide scope & post_type
        return {
            OIDC_CLIENT_ID: this.getClientId(),
            OIDC_CLIENT_SECRET: this.#clientSecret,
            OIDC_GRANT_TYPES: this.#grantTypes,
            OIDC_RESPONSE_TYPES: this.#responseTypes,
            OIDC_TOKEN_ENDPOINT_AUTH_METHOD: this.#tokenEndpointAuthMethod,
            OIDC_ID_TOKEN_SIGNED_RESPONSE_ALG: this.#idTokenSignedResponseAlg,
            OIDC_REDIRECT_URIS: this.#redirectUris,
            OIDC_GATEWAY_URI: this.#gatewayUri
        }
    }

    hasSecret() {
        return !!this.#clientSecret
    }

    generateSecret() {
        this.#clientSecret = randomUUID()
        return this
    }

    getSecretName() {
        return `oidc-client-${this.#clientName}-owner-secrets` // TODO: replaceable template in constants
    }

    getClientId() {
        return this.#clientNamespace + '-' + this.#clientName // TODO: replaceable template in constants
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
