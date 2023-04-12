import {randomUUID} from "crypto";

class OIDCClient {
    constructor() {
        this.clientName = null
        this.clientNamespace = null
        this.clientSecret = null
        this.grantTypes = null
        this.responseTypes = null
        this.redirectUris = null
        this.gatewayUri = null
        this.resourceVersion = null
        this.status = {
            gateway: null
        }
    }

    fromRedis (redisData) {
        this.clientName = redisData.client_name
        this.clientNamespace = redisData.client_namespace
        this.clientSecret = redisData.client_secret
        this.grantTypes = redisData.grant_types
        this.responseTypes = redisData.response_types
        this.redirectUris = redisData.redirect_uris
        this.gatewayUri = redisData.gateway_uri
    }

    toRedis () {
        return {
            client_id: this.getClientId(),
            client_name: this.clientName,
            client_namespace: this.clientNamespace,
            client_secret: this.clientSecret,
            grant_types: this.grantTypes,
            response_types: this.responseTypes,
            redirect_uris: this.redirectUris,
            gateway_uri: this.gatewayUri
        }
    }

    fromIncomingClient (incomingClient) {
        this.clientName = incomingClient.metadata.name
        this.clientNamespace = incomingClient.metadata.namespace
        this.grantTypes = [ 'implicit', 'refresh_token', 'authorization_code' ] // TODO: maybe let user choose
        this.responseTypes = [ 'id_token' ]
        this.redirectUris = incomingClient.redirectUris
        this.gatewayUri = process.env.ISSUER_URL
        this.resourceVersion = incomingClient.metadata.resourceVersion
        this.status = {...this.status, ...incomingClient.status}
        return this
    }

    toClientSecret() {
        // TODO: provide scope & post_type
        return {
            OIDC_CLIENT_ID: this.getClientId(),
            OIDC_GRANT_TYPES: this.grantTypes,
            OIDC_RESPONSE_TYPES: this.responseTypes,
            OIDC_REDIRECT_URIS: this.redirectUris,
            OIDC_GATEWAY_URI: this.gatewayUri
        }
    }

    generateSecret () {
        this.clientSecret = randomUUID()
        return this
    }

    getSecretName () {
        return `oidc-client-${this.clientName}-owner-secrets` // TODO: replaceable template in constants
    }

    getClientId () {
        return this.clientNamespace + '-' + this.clientName // TODO: replaceable template in constants
    }
}

export default OIDCClient
