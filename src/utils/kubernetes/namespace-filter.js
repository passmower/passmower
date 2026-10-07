import picomatch from "picomatch";

export class NamespaceFilter {
    namespace = undefined
    #namespaces = [ '*' ]

    constructor(currentNamespace) {
        const filter = process.env.NAMESPACE_SELECTOR
        if (filter) {
            const namespaces = filter.split(',')
            if (namespaces.length === 1) {
                const namespace = namespaces[0]
                if (!namespace.includes('*')) {
                    this.namespace = namespace
                }
                this.#namespaces = namespace
            } else {
                this.#namespaces = namespaces
            }
        } else {
            this.namespace = currentNamespace
        }
    }

    // Every selector entry must match, so exclusions narrow a wildcard:
    // "*,!kube-*" is every namespace except the kube-* ones.
    filter (namespace) {
        return [].concat(this.#namespaces).every((pattern) => picomatch(pattern)(namespace))
    }
}
