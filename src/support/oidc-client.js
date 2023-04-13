import {randomUUID} from "crypto";

class OIDCClient {
    #clientName = null
    #clientNamespace = null
    #clientSecret = null
    #grantTypes = null
    #responseTypes = null
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
            response_types: this.#responseTypes,
            redirect_uris: this.#redirectUris,
            gateway_uri: this.#gatewayUri
        }
    }

    fromIncomingClient(incomingClient) {
        this.#clientName = incomingClient.metadata.name
        this.#clientNamespace = incomingClient.metadata.namespace
        this.#grantTypes = [ 'implicit', 'refresh_token', 'authorization_code' ] // TODO: maybe let user choose
        this.#responseTypes = [ 'id_token' ]
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
