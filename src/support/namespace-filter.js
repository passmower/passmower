import microMatch from "micromatch";

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

    filter (namespace) {
        return microMatch.isMatch(namespace, this.#namespaces)
    }
}
