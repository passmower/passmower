import {KubernetesAdapter} from "../adapters/kubernetes.js";
import {
    IngressApiGroup,
    IngressApiGroupVersion,
    IngressCrd,
    OIDCClientCrd,
} from "../utils/kubernetes/kube-constants.js";
import {KubeOwnerMetadata} from "../utils/kubernetes/kube-owner-metadata.js";
import {NamespaceFilter} from "../utils/kubernetes/namespace-filter.js";
import {
    discoveredClientLabels,
    discoveryProblems,
    isDiscoveredFrom,
    oidcClientSpecFor,
    requestsDiscovery,
} from "../utils/kubernetes/ingress-oidc-client.js";

// Enrolls applications from Ingress annotations (#35): an annotated Ingress
// gets an OIDCClient, owned by that Ingress, and the client operator takes it
// from there. Discovery only ever materialises a resource — it does not talk to
// Redis or issue secrets — so there is one client code path, an `OIDCClient` the
// operator can inspect for what was discovered, and no orphan to clean up when
// the Ingress goes away, because ownerReferences collect it.
export class KubeIngressDiscoveryOperator {
    // `clientOperator` is optional: without it, discovery still creates and
    // withdraws clients, and a client whose spec.ingressRef points at a changed
    // Ingress simply waits for its next reconcile rather than being asked for
    // one immediately.
    constructor(adapter = new KubernetesAdapter(), clientOperator = undefined) {
        this.adapter = adapter
        this.clientOperator = clientOperator
        this.namespaceFilter = new NamespaceFilter(this.adapter.namespace)
    }

    async watchIngresses() {
        this.adapter.setWatchParameters(
            IngressCrd,
            (ingress) => ingress,
            (ingress) => this.#reconcile(ingress),
            (ingress) => this.#reconcile(ingress),
            // An Ingress being deleted takes its generated client with it
            // through the ownerReference, so there is nothing to do here.
            () => undefined,
            this.namespaceFilter,
            IngressApiGroup,
            IngressApiGroupVersion,
        )
        await this.adapter.watchObjects()
    }

    async #reconcile(ingress) {
        const namespace = ingress?.metadata?.namespace
        const name = ingress?.metadata?.name
        if (!namespace || !name) {
            return
        }
        await this.#reconcileReferencingClients(ingress)
        try {
            const existing = await this.adapter.getNamespacedCustomObject(
                OIDCClientCrd, namespace, name, (client) => client)

            if (!requestsDiscovery(ingress)) {
                // Annotations removed: withdraw what we generated, and never
                // touch a client we did not.
                if (existing && isDiscoveredFrom(existing, ingress)) {
                    await this.adapter.deleteNamespacedCustomObject(OIDCClientCrd, namespace, name)
                    await this.#event(ingress, 'OIDCClientRemoved',
                        `Removed generated OIDCClient ${name}: no ${'codemowers.io/oidc-*'} annotations remain`,
                        'Normal')
                }
                return
            }

            if (existing && !isDiscoveredFrom(existing, ingress)) {
                // A hand-written client of the same name is authoritative: the
                // resource in Git wins over an annotation, and quietly patching
                // it from an Ingress would be the wrong way round.
                await this.#event(ingress, 'OIDCClientConflict',
                    `OIDCClient ${name} already exists and was not discovered from this Ingress; not modifying it`)
                return
            }

            const problems = discoveryProblems(ingress)
            if (problems.length) {
                await this.#event(ingress, 'IngressDiscoveryFailed',
                    `Cannot derive an OIDCClient: ${problems.join('; ')}`)
                return
            }

            const spec = oidcClientSpecFor(ingress)
            if (existing) {
                await this.#patchClient(ingress, existing, spec)
                return
            }
            await this.#createClient(ingress, spec)
        } catch (error) {
            globalThis.logger?.error({error, ingress: `${namespace}/${name}`},
                'Failed to reconcile Ingress into an OIDCClient')
        }
    }

    async #createClient(ingress, spec) {
        const {namespace, name} = ingress.metadata
        const created = await this.adapter.createNamespacedCustomObject(
            OIDCClientCrd,
            namespace,
            name,
            {spec},
            (client) => client,
            new KubeOwnerMetadata(
                IngressCrd, name, ingress.metadata.uid, IngressApiGroup, IngressApiGroupVersion),
            discoveredClientLabels(ingress),
        )
        if (!created) {
            await this.#event(ingress, 'IngressDiscoveryFailed',
                `Failed to create OIDCClient ${name}`)
            return
        }
        await this.#event(ingress, 'OIDCClientDiscovered',
            `Created OIDCClient ${name} for ${spec.uri}`, 'Normal')
    }

    async #patchClient(ingress, existing, spec) {
        const {namespace, name} = ingress.metadata
        // Only the fields the annotations describe: anything else on the
        // generated client — including status — is left as it is.
        const desired = {...existing.spec, ...spec}
        if (JSON.stringify(desired) === JSON.stringify(existing.spec)) {
            return
        }
        const patched = await this.adapter.patchNamespacedCustomObject(
            OIDCClientCrd,
            namespace,
            name,
            {spec: desired},
            {spec: existing.spec},
            (client) => client,
        )
        if (!patched) {
            await this.#event(ingress, 'IngressDiscoveryFailed',
                `Failed to update OIDCClient ${name}`)
            return
        }
        await this.#event(ingress, 'OIDCClientDiscovered',
            `Updated OIDCClient ${name} for ${spec.uri}`, 'Normal')
    }

    // A client with spec.ingressRef resolves its host from this Ingress, and a
    // changed host does not touch the client, so nothing else would ask it to
    // reconcile: its generation is unmoved and the operator's fingerprint check
    // skips it. Waiting for the next watch re-list would leave the client
    // registered with a stale redirect URI in the meantime, which fails logins
    // with a mismatch.
    async #reconcileReferencingClients(ingress) {
        if (!this.clientOperator) {
            return
        }
        const {namespace, name} = ingress.metadata
        try {
            const clients = await this.adapter.listNamespacedCustomObject(
                OIDCClientCrd, namespace, (client) => client)
            const referencing = (clients ?? [])
                .filter(client => client?.spec?.ingressRef?.name === name)
            for (const client of referencing) {
                await this.clientOperator.reconcileClientByName(namespace, client.metadata.name)
            }
        } catch (error) {
            globalThis.logger?.error({error, ingress: `${namespace}/${name}`},
                'Failed to reconcile clients referencing an Ingress')
        }
    }

    // Events land on the Ingress, which is where somebody who wrote an
    // annotation goes looking.
    async #event(ingress, reason, message, type = 'Warning') {
        await this.adapter.createEvent(
            ingress.metadata.namespace,
            new KubeOwnerMetadata(
                IngressCrd, ingress.metadata.name, ingress.metadata.uid,
                IngressApiGroup, IngressApiGroupVersion),
            reason,
            message,
            type,
        )
    }
}
