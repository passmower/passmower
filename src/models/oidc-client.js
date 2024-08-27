import {randomUUID} from "crypto";
import configuration from "../configuration.js";
import {
    OIDCClientCrd,
    OIDCClientId,
    OIDCClientSecretAllowedGroupsKey,
    OIDCClientSecretAuthUriKey,
    OIDCClientSecretAvailableScopesKey,
    OIDCClientSecretClientIdKey,
    OIDCClientSecretClientSecretKey,
    OIDCClientSecretIdpUriKey,
    OIDCClientSecretGrantTypesKey,
    OIDCClientSecretIdTokenSignedResponseAlgKey,
    OIDCClientSecretName,
    OIDCClientSecretRedirectUrisKey,
    OIDCClientSecretResponseTypesKey,
    OIDCClientSecretTokenEndpointAuthMethodKey,
    OIDCClientSecretTokenUriKey,
    OIDCClientSecretUserInfoUriKey
} from "../utils/kubernetes/kube-constants.js";
import {KubeOwnerMetadata} from "../utils/kubernetes/kube-owner-metadata.js";
import sortObject from "../utils/sort-object.js";

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
    #overrideIncomingScopes = null
    #availableScopes = null
    #instanceUri = null
    #uri = null
    #displayName = null
    #resourceVersion = null
    #status = {
        instance: null
    }
    #uid = null
    #pkce = true
    #conditions = {}
    #allowedCORSOrigins = null
    #secretMetadata = null
    #secretRefreshPod = null

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
            instanceUri: this.#instanceUri,
            uri: this.#uri,
            displayName: this.#displayName,
            pkce: this.#pkce,
            overrideIncomingScopes: this.#overrideIncomingScopes,
            allowedCORSOrigins: this.#allowedCORSOrigins,
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
        this.#overrideIncomingScopes = incomingClient.spec.overrideIncomingScopes
        this.#availableScopes = incomingClient.spec.availableScopes
        this.#instanceUri = process.env.ISSUER_URL
        this.#uri = incomingClient.spec.uri
        this.#displayName = incomingClient.spec.displayName
        this.#resourceVersion = incomingClient.metadata.resourceVersion
        this.#status = {...this.#status, ...incomingClient.status}
        this.#uid = incomingClient.metadata.uid
        this.#pkce = incomingClient.spec.pkce ?? true
        this.#conditions = incomingClient.status?.conditions ?? []
        this.#secretMetadata = incomingClient.spec?.secretMetadata ?? []
        this.#secretRefreshPod = incomingClient.spec?.secretRefreshPod ?? null // TODO: validate
        this.#allowedCORSOrigins = incomingClient.spec?.allowedCORSOrigins
        return this
    }

    toClientSecret(provider) {
        return sortObject({
            [OIDCClientSecretClientIdKey]: this.getClientId(),
            [OIDCClientSecretClientSecretKey]: this.#clientSecret,
            [OIDCClientSecretGrantTypesKey]: this.#grantTypes.join(','),
            [OIDCClientSecretResponseTypesKey]: this.#responseTypes.join(','),
            [OIDCClientSecretTokenEndpointAuthMethodKey]: this.#tokenEndpointAuthMethod,
            [OIDCClientSecretIdTokenSignedResponseAlgKey]: this.#idTokenSignedResponseAlg,
            [OIDCClientSecretRedirectUrisKey]: this.#redirectUris.join(','),
            [OIDCClientSecretIdpUriKey]: this.#instanceUri,
            [OIDCClientSecretAvailableScopesKey]: this.#availableScopes.join(','),
            [OIDCClientSecretAuthUriKey]: provider.urlFor('authorization'),
            [OIDCClientSecretTokenUriKey]: provider.urlFor('token'),
            [OIDCClientSecretUserInfoUriKey]: provider.urlFor('userinfo'),
            [OIDCClientSecretAllowedGroupsKey]: this.#allowedGroups.join(','),
        })
    }

    toClientSecretMetadata() {
        return {
            ownerReferences: [
                new KubeOwnerMetadata(
                    OIDCClientCrd,
                    this.#clientName,
                    this.#uid
                )
            ],
            ...this.#secretMetadata
        }
    }

    getConditions() {
        return this.#conditions
    }

    setConditions(conditions) {
        this.#conditions = conditions
        return this
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
        return OIDCClientSecretName(this.#clientName)
    }

    getClientId() {
        return OIDCClientId(this.#clientNamespace, this.#clientName)
    }

    getInstance() {
        return this.#status.instance
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

    getSecretRefreshPod() {
        let podSpec = this.#secretRefreshPod
        if (!podSpec) {
            return undefined
        }
        podSpec.metadata = podSpec.metadata || {}
        podSpec.metadata.name = podSpec.metadata.name || `${this.getClientName()}-${this.getResourceVersion()}`
        podSpec.metadata.ownerReferences = [
            new KubeOwnerMetadata(
                OIDCClientCrd,
                this.getClientName(),
                this.#uid
            )
        ];
        podSpec.spec.restartPolicy = podSpec.spec.restartPolicy || 'Never'
        return podSpec
    }
}

export default OIDCClient
