import {KubernetesAdapter} from '../adapters/kubernetes.js'
import RedisAdapter from '../adapters/redis.js'
import {OidcUserEventHook} from '../models/oidc-user-event-hook.js'
import {NamespaceFilter} from '../utils/kubernetes/namespace-filter.js'
import {OIDCUserCrd, OIDCUserEventHookCrd} from '../utils/kubernetes/kube-constants.js'

// Marks that the store has seen a full listing once. UIDs are UUIDs, so this
// cannot collide with one.
const initializedKey = '__initialized__'

export class KubeOidcUserEventHookOperator {
    constructor(adapter = new KubernetesAdapter(), stateRedis = new RedisAdapter('OIDCUserEventHookState')) {
        this.adapter = adapter
        this.state = stateRedis
    }

    async watchUsers() {
        await this.#seedOnFirstRun()
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

    // Stand down without ending the process: this pod keeps serving HTTP
    // after it loses the operator lease (#236).
    stop() {
        this.adapter.stopWatching()
    }

    // The generation each user was last dispatched at lives in Redis rather than
    // in this process. Kubernetes reports every existing object as ADDED when a
    // watch is re-established, and an in-memory map only suppresses that for as
    // long as the process lives: a restart — or, once the operators are
    // leader-elected, an ordinary handover — would see every user as new and
    // dispatch an Added hook for the lot. The Job name is a digest of the user
    // and generation, so `ignoreAlreadyExists` hides the duplicate, but only
    // until ttlSecondsAfterFinished collects the Job an hour later (#236).
    async #lastGeneration(uid) {
        return (await this.state.find(uid))?.generation
    }

    async #remember(uid, generation) {
        await this.state.upsert(uid, {generation})
    }

    // On the very first run the store is empty, and without this every user
    // would look new — the same mass dispatch, once, on the upgrade that
    // introduces the store. Record what already exists instead, and dispatch
    // nothing for it.
    async #seedOnFirstRun() {
        if (await this.state.find(initializedKey)) {
            return
        }
        const users = await this.adapter.listNamespacedCustomObject(
            OIDCUserCrd, this.adapter.namespace, user => user)
        if (!Array.isArray(users)) {
            // Marking the store initialized off a failed listing would suppress
            // a real Added for every user it should have seen. Try again next boot.
            globalThis.logger?.warn('Could not list OIDCUsers to seed event hook state; deferring')
            return
        }
        for (const user of users) {
            await this.#remember(user.metadata.uid, user.metadata.generation ?? 1)
        }
        await this.state.upsert(initializedKey, {initializedAt: new Date().toISOString()})
        globalThis.logger?.info({users: users.length}, 'Seeded OIDCUser event hook state')
    }

    async #added(user) {
        const generation = user.metadata.generation ?? 1
        const previousGeneration = await this.#lastGeneration(user.metadata.uid)
        // Suppress the synthetic re-list event; if the generation advanced while
        // nothing was watching, preserve that missed spec edge as a Modified.
        if (previousGeneration === generation) return
        await this.#remember(user.metadata.uid, generation)
        await this.#dispatch({type: previousGeneration === undefined ? 'Added' : 'Modified', user})
    }

    async #modified(user) {
        const generation = user.metadata.generation ?? 1
        if (await this.#lastGeneration(user.metadata.uid) === generation) return
        await this.#remember(user.metadata.uid, generation)
        await this.#dispatch({type: 'Modified', user})
    }

    async #deleted(user) {
        await this.state.destroy(user.metadata.uid)
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
