import Account from "../support/account.js";
import {KubernetesAdapter} from "../adapters/kubernetes.js";
import {OIDCGWUser} from "../support/kube-constants.js";

export class KubeOIDCUserService {
    constructor() {
        this.adapter = new KubernetesAdapter()
    }

    async listUsers() {
        return await this.adapter.listNamespacedCustomObject(
            OIDCGWUser,
            this.adapter.namespace,
            (apiResponse) => (new Account()).fromKubernetes(apiResponse)
        )
    }

    async findUser(id) {
        return await this.adapter.getNamespacedCustomObject(
            OIDCGWUser,
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
        const spec = {
            email,
            githubEmails,
            githubProfile: {},
            customProfile: {},
        }
        const user = await this.adapter.createNamespacedCustomObject(
            OIDCGWUser,
            this.adapter.namespace,
            id,
            spec,
            (apiResponse) => (new Account()).fromKubernetes(apiResponse)
        )
        return await this.updateUserStatus(user)
    }

    async updateUserSpec({accountId, email, customGroups, customProfile, githubEmails, githubGroups, githubProfile, slackId} = {}) {
        const account = await this.findUser(accountId)
        const updatedUser = await this.adapter.patchNamespacedCustomObject(
            OIDCGWUser,
            this.adapter.namespace,
            accountId,
            arguments[0],
            account.spec,
            (apiResponse) => (new Account()).fromKubernetes(apiResponse)
        )
        return await this.updateUserStatus(updatedUser)
    }

    async updateUserStatus(account) {
        return await this.adapter.replaceNamespacedCustomObjectStatus(
            OIDCGWUser,
            this.adapter.namespace,
            account.accountId,
            account.resourceVersion,
            account.getIntendedStatus(),
            (apiResponse) => (new Account()).fromKubernetes(apiResponse)
        )
    }
}
