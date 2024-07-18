import {KubeOwnerMetadata} from "../utils/kubernetes/kube-owner-metadata.js";
import {
    OIDCMiddlewareClientCrd,
    OIDCMiddlewareClientId,
    TraefikMiddlewareForwardAuthAddress
} from "../utils/kubernetes/kube-constants.js";
import {randomUUID} from "crypto";

export const grantType = 'implicit'
export const responseType = 'id_token'
export const scope = 'openid'

export default class OIDCMiddlewareClient {
    #clientName = null
    #clientNamespace = null
    #allowedGroups = null
    #headerMapping = null
    #uri = null
    #displayName = null
    #resourceVersion = null
    #status = {
        instance: null
    }
    #uid = null
    #conditions = []

    fromIncomingClient(incomingClient) {
        this.#clientName = incomingClient.metadata.name
        this.#clientNamespace = incomingClient.metadata.namespace
        this.#allowedGroups = incomingClient.spec.allowedGroups || []
        this.#headerMapping = incomingClient.spec.headerMapping || []
        this.#uri = incomingClient.spec.uri
        this.#displayName = incomingClient.spec.displayName
        this.#resourceVersion = incomingClient.metadata.resourceVersion
        this.#status = {...this.#status, ...incomingClient.status}
        this.#uid = incomingClient.metadata.uid
        this.#conditions = incomingClient.status?.conditions ?? []
        return this
    }

    toRedis() {
        return {
            client_id: this.getClientId(),
            client_name: this.#clientName,
            client_namespace: this.#clientNamespace,
            client_secret: randomUUID(),
            grant_types: [ grantType ],
            response_types: [ responseType ],
            availableScopes: [ scope ],
            allowedGroups: this.#allowedGroups,
            headerMapping: this.#headerMapping,
            uri: this.#uri,
            displayName: this.#displayName,
            kind: OIDCMiddlewareClientCrd
        }
    }

    toMiddlewareSpec(deployment, namespace) {
        return {
            forwardAuth: {
                address: TraefikMiddlewareForwardAuthAddress(deployment, namespace, this.getClientId()),
                trustForwardHeader: true,
                authResponseHeaders: Object.values(this.#headerMapping)
            }
        }
    }

    getConditions() {
        return this.#conditions
    }

    setConditions(conditions) {
        this.#conditions = conditions
        return this
    }

    getClientId() {
        return OIDCMiddlewareClientId(this.#clientNamespace, this.#clientName)
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

    getInstance() {
        return this.#status.instance
    }

    getMetadata() {
        return new KubeOwnerMetadata(
            OIDCMiddlewareClientCrd,
            this.#clientName,
            this.#uid
        )
    }
}
