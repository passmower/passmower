import Account from "../models/account.js";
import {KubernetesAdapter} from "../adapters/kubernetes.js";
import {OIDCUserCrd} from "../utils/kubernetes/kube-constants.js";
import {ClaimedBy} from "../conditions/claimed-by.js";
import merge from "lodash/merge.js";
import cloneDeep from "lodash/cloneDeep.js";

export class KubeOIDCUserService {
    constructor() {
        this.adapter = new KubernetesAdapter()
    }

    async listUsers() {
        return await this.adapter.listNamespacedCustomObject(
            OIDCUserCrd,
            this.adapter.namespace,
            (apiResponse) => (new Account()).fromKubernetes(apiResponse)
        )
    }

    async findUser(id) {
        return await this.adapter.getNamespacedCustomObject(
            OIDCUserCrd,
            this.adapter.namespace,
            id,
            (apiResponse) => (new Account()).fromKubernetes(apiResponse)
        )
    }

    async findUserByEmails(emails) {
        const emailsInKube = []
        const allUsers = await this.listUsers()
        allUsers.map(user => {
            user.emails.map((email) => {
                emailsInKube.push({
                    email: email,
                    user: user
                })
            })
        })
        const foundUser = emailsInKube.find((element) => {
            return emails.includes(element.email)
        })
        return foundUser?.user
    }

    async createUser(id, email, githubEmails) {
        const user = await this.adapter.createNamespacedCustomObject(
            OIDCUserCrd,
            this.adapter.namespace,
            id,
            {
                spec: {},
                passmower: {
                    email
                },
                github: {
                    emails: githubEmails
                }
            },
            (apiResponse) => (new Account()).fromKubernetes(apiResponse),
            undefined,
            (new ClaimedBy(this.adapter.instance)).setStatus(true).toLabels(),
        )
        return await this.updateUserStatus(user)
    }

    async updateUserSpecs(accountId, {passmower, slack, github} = {}) {
        let account = await this.findUser(accountId)
        let extended = merge(cloneDeep(account.getSpecs()), arguments[1])
        const updatedUser = await this.adapter.patchNamespacedCustomObject(
            OIDCUserCrd,
            this.adapter.namespace,
            accountId,
            extended,
            account.getSpecs(),
            (apiResponse) => (new Account()).fromKubernetes(apiResponse)
        )
        return await this.updateUserStatus(updatedUser)
    }

    async replaceUserLabels(updatedUser) {
        await this.adapter.patchNamespacedCustomObject(
            OIDCUserCrd,
            this.adapter.namespace,
            updatedUser.accountId,
            {
                ['/metadata']: {
                    labels: updatedUser.getLabels()
                }
            },
            {
                ['/metadata']: {
                    labels: updatedUser.getLabels()
                }
            },
            (apiResponse) => (new Account()).fromKubernetes(apiResponse)
        )
    }

    async updateUserStatus(account) {
        return await this.adapter.replaceNamespacedCustomObjectStatus(
            OIDCUserCrd,
            this.adapter.namespace,
            account.accountId,
            account.resourceVersion,
            account.getIntendedStatus(),
            (apiResponse) => (new Account()).fromKubernetes(apiResponse)
        )
    }
}
