import {KubernetesAdapter} from '../adapters/kubernetes.js'
import {OidcUserEventHook} from '../models/oidc-user-event-hook.js'
import {NamespaceFilter} from '../utils/kubernetes/namespace-filter.js'
import {OIDCUserCrd, OIDCUserEventHookCrd} from '../utils/kubernetes/kube-constants.js'

export class KubeOidcUserEventHookOperator {
    constructor(adapter = new KubernetesAdapter()) {
        this.adapter = adapter
        this.generations = new Map()
    }

    async watchUsers() {
        this.adapter.setWatchParameters(
            OIDCUserCrd,
            user => user,
            user => this.#added(user),
            user => this.#modified(user),
            user => this.#deleted(user),
            new NamespaceFilter(this.adapter.namespace),
        )
        await this.adapter.watchObjects()
    }

    async #added(user) {
        const generation = user.metadata.generation ?? 1
        // Kubernetes reports every existing object as ADDED when a watch is
        // re-established. Suppress those synthetic events within this process,
        // including after the user has advanced to a newer generation.
        if (this.generations.get(user.metadata.uid) === generation) return
        this.generations.set(user.metadata.uid, generation)
        await this.#dispatch({type: 'Added', user})
    }

    async #modified(user) {
        const generation = user.metadata.generation ?? 1
        if (this.generations.get(user.metadata.uid) === generation) return
        this.generations.set(user.metadata.uid, generation)
        await this.#dispatch({type: 'Modified', user})
    }

    async #deleted(user) {
        this.generations.delete(user.metadata.uid)
        await this.#dispatch({type: 'Deleted', user})
    }

    async #dispatch(event) {
        const hooks = await this.adapter.listNamespacedCustomObject(
            OIDCUserEventHookCrd,
            event.user.metadata.namespace,
            resource => new OidcUserEventHook().fromKubernetes(resource),
        ) ?? []
        for (const hook of hooks.filter(item => item.matches(event))) {
            await this.#runHook(hook, event)
        }
    }

    async #runHook(hook, event) {
        const job = hook.getJob(event)
        const result = await this.adapter.createJob(hook.namespace, job, {ignoreAlreadyExists: true})
        const ready = Boolean(result)
        const reason = ready
            ? (result.alreadyExists ? 'JobAlreadyExists' : 'JobCreated')
            : 'JobCreationFailed'
        const message = ready
            ? `${event.type} hook Job ${job.metadata.name} ${result.alreadyExists ? 'already exists' : 'was created'}`
            : `Failed to create ${event.type} hook Job ${job.metadata.name}`
        await this.adapter.mutateNamespacedCustomObjectStatus(
            OIDCUserEventHookCrd, hook.namespace, hook.name,
            resource => new OidcUserEventHook().fromKubernetes(resource),
            current => current.withAttempt(event, job.metadata.name, ready, reason, message),
        )
        if (!ready) {
            await this.adapter.createEvent(hook.namespace, hook.getMetadata(), reason, message)
            globalThis.logger?.error(
                {hook: hook.name, user: event.user.metadata.name, event: event.type},
                'Failed to execute OIDCUserEventHook',
            )
        }
    }
}

export default KubeOidcUserEventHookOperator
