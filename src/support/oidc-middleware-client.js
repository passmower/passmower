import {KubeOwnerMetadata} from "./kube-owner-metadata.js";
import {
    OIDCGWMiddlewareClient,
    OIDCGWMiddlewareClientId,
    TraefikMiddlewareForwardAuthAddress
} from "./kube-constants.js";

export default class OIDCMiddlewareClient {
    #clientName = null
    #clientNamespace = null
    #allowedGroups = null
    #headerMapping = null
    #uri = null
    #resourceVersion = null
    #status = {
        gateway: null
    }
    #uid = null

    fromIncomingClient(incomingClient) {
        this.#clientName = incomingClient.metadata.name
        this.#clientNamespace = incomingClient.metadata.namespace
        this.#allowedGroups = incomingClient.spec.allowedGroups || []
        this.#headerMapping = incomingClient.spec.headerMapping || []
        this.#uri = incomingClient.spec.uri
        this.#resourceVersion = incomingClient.metadata.resourceVersion
        this.#status = {...this.#status, ...incomingClient.status}
        this.#uid = incomingClient.metadata.uid
        return this
    }

    toRedis() {
        return {
            client_id: this.getClientId(),
            client_name: this.#clientName,
            client_namespace: this.#clientNamespace,
            allowedGroups: this.#allowedGroups,
            headerMapping: this.#headerMapping,
            uri: this.#uri,
        }
    }

    toMiddlewareSpec(deployment, namespace) {
        return {
            forwardAuth: {
                address: TraefikMiddlewareForwardAuthAddress(deployment, namespace),
                trustForwardHeader: true,
                authResponseHeaders: Object.values(this.#headerMapping)
            }
        }
    }

    getClientId() {
        return OIDCGWMiddlewareClientId(this.#clientNamespace, this.#clientName)
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

    getGateway() {
        return this.#status.gateway
    }

    getMetadata() {
        return new KubeOwnerMetadata(
            OIDCGWMiddlewareClient,
            this.#clientName,
            this.#uid
        )
    }
}
