import {
    OIDCUserCrd
} from "../utils/kubernetes/kube-constants.js";
import {KubernetesAdapter} from "../adapters/kubernetes.js";
import {NamespaceFilter} from "../utils/kubernetes/namespace-filter.js";
import Account from "../models/account.js";
import {KubeOIDCUserService} from "../services/kube-oidc-user-service.js";
import {ClaimedBy} from "../conditions/claimed-by.js";

export class KubeOIDCUserOperator {
    constructor(provider, adapter = new KubernetesAdapter()) {
        // this.redisAdapter = new RedisAdapter('Client')
        this.provider = provider
        this.adapter = adapter
        this.instance = this.adapter.instance
        this.userService = new KubeOIDCUserService(this.adapter);
        this.reconcileEmailPromise = null
        this.reconcileEmailPending = false
    }

    async watchUsers() {
        this.adapter.setWatchParameters(
            OIDCUserCrd,
            (OIDCUser) => (new Account()).fromKubernetes(OIDCUser),
            (OIDCUser) => this.#claimOIDCUser(OIDCUser),
            (OIDCUser) => this.#updateOIDCUser(OIDCUser),
            () => this.#scheduleEmailReconcile(),
            new NamespaceFilter(this.adapter.namespace)
        )
        await this.adapter.watchObjects()
    }

    async #claimOIDCUser (OIDCUser) {
        let condition = new ClaimedBy(this.adapter.instance)
        condition = condition.setStatus(true)
        OIDCUser.setLabels(condition.toLabels())
        await this.userService.replaceUserLabels(OIDCUser)
        await this.userService.updateUserStatus(OIDCUser)
        await this.#scheduleEmailReconcile()
    }

    async #updateOIDCUser(OIDCUser) {
        if (OIDCUser.getMetadata()?.managedFields?.at(-1)?.manager !== this.instance) {
            await this.userService.updateUserStatus(OIDCUser)
            await this.#scheduleEmailReconcile()
        }
    }

    async #scheduleEmailReconcile() {
        if (this.reconcileEmailPromise) {
            this.reconcileEmailPending = true
            return this.reconcileEmailPromise
        }
        this.reconcileEmailPromise = (async () => {
            do {
                this.reconcileEmailPending = false
                try {
                    await this.userService.reconcileEmailUniqueness()
                } catch (error) {
                    globalThis.logger?.error(error, 'Failed to reconcile OIDCUser email uniqueness')
                }
            } while (this.reconcileEmailPending)
        })().finally(() => {
            this.reconcileEmailPromise = null
            if (this.reconcileEmailPending) {
                return this.#scheduleEmailReconcile()
            }
        })
        return this.reconcileEmailPromise
    }
}

export default KubeOIDCUserOperator
