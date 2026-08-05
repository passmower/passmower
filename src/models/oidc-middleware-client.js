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
    #displayOrder = 0
    #description = null
    #disabled = false
    #lastUsedAt = null
    #creationTimestamp = null
    #generation = null

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
        this.#displayOrder = incomingClient.spec?.displayOrder ?? 0
        this.#description = incomingClient.metadata?.annotations?.['kubernetes.io/description'] ?? null
        this.#disabled = incomingClient.spec?.disabled === true
        this.#lastUsedAt = incomingClient.status?.lastUsedAt ?? null
        this.#creationTimestamp = incomingClient.metadata?.creationTimestamp ?? null
        this.#generation = incomingClient.metadata?.generation ?? null
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
            headerMapping: this.#headerMapping,
            uri: this.#uri,
            displayName: this.#displayName,
            displayOrder: this.#displayOrder,
            description: this.#description,
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

    getGeneration() {
        return this.#generation
    }

    isDisabled() {
        return this.#disabled
    }

    getLastUsedAt() {
        return this.#lastUsedAt
    }

    setLastUsedAt(lastUsedAt) {
        this.#lastUsedAt = lastUsedAt
        return this
    }

    getIntendedStatus() {
        return {
            ...this.#status,
            lastUsedAt: this.#lastUsedAt,
            conditions: this.#conditions,
        }
    }

    updateActivityCondition(now, inactiveAfterDays) {
        const reference = this.#lastUsedAt ?? this.#creationTimestamp
        if (!reference) return this
        const inactive = now.getTime() - new Date(reference).getTime() >= inactiveAfterDays * 86400000
        const previous = this.#conditions.find(condition => condition.type === 'Inactive')
        const status = inactive ? 'True' : 'False'
        const condition = {
            type: 'Inactive',
            status,
            reason: inactive ? 'NotUsedRecently' : 'RecentlyUsed',
            message: inactive
                ? `Client has not been used for at least ${inactiveAfterDays} days`
                : `Client was used within the last ${inactiveAfterDays} days`,
            lastTransitionTime: previous?.status === status ? previous.lastTransitionTime : now.toISOString(),
        }
        this.#conditions = [...this.#conditions.filter(item => item.type !== 'Inactive'), condition]
        return this
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
