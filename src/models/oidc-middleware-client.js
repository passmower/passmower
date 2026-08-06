import {KubeOwnerMetadata} from "../utils/kubernetes/kube-owner-metadata.js";
import {
    OIDCMiddlewareClientCrd,
    OIDCMiddlewareClientId,
    TraefikMiddlewareForwardAuthAddress
} from "../utils/kubernetes/kube-constants.js";
import {randomUUID} from "crypto";
import {ClientActivityState} from './client-activity-state.js';

export const grantType = 'implicit'
export const responseType = 'id_token'
export const scope = 'openid'

export default class OIDCMiddlewareClient {
    #clientName = null
    #clientNamespace = null
    #allowedGroups = null
    #allowedUsers = null
    #headerMapping = null
    #uri = null
    #displayName = null
    #resourceVersion = null
    #uid = null
    #displayOrder = 0
    #disabled = false
    #activityState = null

    fromIncomingClient(incomingClient) {
        this.#clientName = incomingClient.metadata.name
        this.#clientNamespace = incomingClient.metadata.namespace
        this.#allowedGroups = incomingClient.spec.allowedGroups || []
        this.#allowedUsers = incomingClient.spec.allowedUsers || []
        this.#headerMapping = incomingClient.spec.headerMapping || []
        this.#uri = incomingClient.spec.uri
        this.#displayName = incomingClient.spec.displayName
        this.#resourceVersion = incomingClient.metadata.resourceVersion
        this.#uid = incomingClient.metadata.uid
        this.#displayOrder = incomingClient.spec?.displayOrder ?? 0
        this.#disabled = incomingClient.spec?.disabled === true
        this.#activityState = new ClientActivityState(incomingClient)
        return this
    }

    toRedis() {
        return {
            client_id: this.getClientId(),
            client_name: this.#clientName,
            clientNamespace: this.#clientNamespace,
            client_secret: randomUUID(),
            grant_types: [ grantType ],
            response_types: [ responseType ],
            availableScopes: [ scope ],
            allowedGroups: this.#allowedGroups,
            allowedUsers: this.#allowedUsers,
            headerMapping: this.#headerMapping,
            uri: this.#uri,
            displayName: this.#displayName,
            displayOrder: this.#displayOrder,
            description: this.#activityState.description,
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
        return this.#activityState.conditions
    }

    setConditions(conditions) {
        this.#activityState.conditions = conditions
        return this
    }

    getClientId() {
        return OIDCMiddlewareClientId(this.#clientNamespace, this.#clientName)
    }

    getKind() {
        return OIDCMiddlewareClientCrd
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

    isDisabled() {
        return this.#disabled
    }

    getLastUsedAt() {
        return this.#activityState.lastUsedAt
    }

    setLastUsedAt(lastUsedAt) {
        this.#activityState.lastUsedAt = lastUsedAt
        return this
    }

    getIntendedStatus() {
        return this.#activityState.getIntendedStatus()
    }

    updateActivityCondition(now, inactiveAfterDays) {
        this.#activityState.updateActivityCondition(now, inactiveAfterDays)
        return this
    }

    getReconcileFingerprint() {
        return this.#activityState.getReconcileFingerprint()
    }

    getInstance() {
        return this.#activityState.status.instance
    }

    getMetadata() {
        return new KubeOwnerMetadata(
            OIDCMiddlewareClientCrd,
            this.#clientName,
            this.#uid
        )
    }
}
