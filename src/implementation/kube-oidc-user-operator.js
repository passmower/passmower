import {
    OIDCGWUser
} from "../support/kube-constants.js";
import {KubernetesAdapter} from "../adapters/kubernetes.js";
import {NamespaceFilter} from "../support/namespace-filter.js";
import Account from "../support/account.js";
import {KubeOIDCUserService} from "./kube-oidc-user-service.js";
import {ClaimedBy} from "../support/conditions/claimed-by.js";

export class KubeOIDCUserOperator {
    constructor(provider) {
        // this.redisAdapter = new RedisAdapter('Client')
        this.provider = provider
        this.adapter = new KubernetesAdapter()
        this.currentGateway = this.adapter.currentGateway
        this.userService = new KubeOIDCUserService();
    }

    async watchUsers() {
        this.adapter.setWatchParameters(
            OIDCGWUser,
            (OIDCUser) => (new Account()).fromKubernetes(OIDCUser),
            (OIDCUser) => this.#claimOIDCUser(OIDCUser),
            (OIDCUser) => this.#updateOIDCUser(OIDCUser),
            (OIDCUser) => (OIDCUser),
            new NamespaceFilter(this.adapter.namespace)
        )
        await this.adapter.watchObjects()
    }

    async #claimOIDCUser (OIDCUser) {
        if (!(new ClaimedBy(this.adapter.currentGateway)).check(OIDCUser)) {
            let condition = new ClaimedBy(this.adapter.currentGateway)
            condition = condition.setStatus(true)
            OIDCUser.setLabels(condition.toLabels())
            await this.userService.replaceUserLabels(OIDCUser)
        }
    }

    async #updateOIDCUser(OIDCUser) {
        await this.userService.updateUserStatus(OIDCUser)
    }
}

export default KubeOIDCUserOperator
