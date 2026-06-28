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
    OIDCClientSecretUserInfoUriKey,
    OIDCClientSecretWellKnownUriKey
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
    #applicationType = null
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
    #secretRefreshJobSpec = null
    #displayOrder = 0
    #description = null

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
            application_type: this.#applicationType,
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
            displayOrder: this.#displayOrder,
            description: this.#description,
        }
    }

    fromIncomingClient(incomingClient) {
        this.#clientName = incomingClient.metadata.name
        this.#clientNamespace = incomingClient.metadata.namespace
        this.#grantTypes = incomingClient.spec.grantTypes
        this.#responseTypes = incomingClient.spec.responseTypes
        this.#tokenEndpointAuthMethod = incomingClient.spec.tokenEndpointAuthMethod || configuration.clientDefaults.token_endpoint_auth_method
        this.#idTokenSignedResponseAlg = incomingClient.spec.idTokenSignedResponseAlg || configuration.clientDefaults.id_token_signed_response_alg
        this.#applicationType = incomingClient.spec.applicationType || configuration.clientDefaults.application_type
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
        this.#secretMetadata = incomingClient.spec?.secretMetadata ?? {}
        this.#secretRefreshJobSpec = incomingClient.spec?.secretRefreshJobSpec ?? null // TODO: validate
        this.#allowedCORSOrigins = incomingClient.spec?.allowedCORSOrigins
        this.#displayOrder = incomingClient.spec?.displayOrder ?? 0
        this.#description = incomingClient.metadata?.annotations?.['kubernetes.io/description'] ?? null
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
            [OIDCClientSecretWellKnownUriKey]: new URL('.well-known/openid-configuration', this.#instanceUri).href,
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

    // Build the secret-refresh Job from the user-supplied JobSpec. Using a Job
    // (instead of a bare Pod) gets Kubernetes scheduler retries and a
    // kube_job_failed metric for alerting; labels make alert rules specific and
    // the ownerReference garbage-collects the Job with its OIDCClient (#70).
    getSecretRefreshJob() {
        const jobSpec = this.#secretRefreshJobSpec
        if (!jobSpec) {
            return undefined
        }
        // Jobs require restartPolicy Never|OnFailure on the pod template.
        jobSpec.template = jobSpec.template || {}
        jobSpec.template.spec = jobSpec.template.spec || {}
        jobSpec.template.spec.restartPolicy = jobSpec.template.spec.restartPolicy || 'OnFailure'
        return {
            apiVersion: 'batch/v1',
            kind: 'Job',
            metadata: {
                name: `${this.getClientName()}-secret-refresh-${this.getResourceVersion()}`,
                ownerReferences: [
                    new KubeOwnerMetadata(OIDCClientCrd, this.getClientName(), this.#uid)
                ],
                labels: {
                    'app.kubernetes.io/managed-by': 'passmower',
                    'app.kubernetes.io/component': 'secret-refresh',
                    'codemowers.cloud/oidc-client': this.getClientName(),
                },
            },
            spec: jobSpec,
        }
    }
}

export default OIDCClient
