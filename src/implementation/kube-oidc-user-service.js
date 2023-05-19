import * as k8s from "@kubernetes/client-node";
import Account from "../support/account.js";
import {
    OIDCGWUser,
    OIDCGWUsers,
    apiGroup,
    apiGroupVersion,
} from "../support/kube-constants.js";

export class KubeOIDCUserService {
    constructor() {
        const kc = new k8s.KubeConfig();
        this.kc = kc
        kc.loadFromCluster()
        this.customObjectsApi = kc.makeApiClient(k8s.CustomObjectsApi);
        this.coreV1Api = kc.makeApiClient(k8s.CoreV1Api);
        this.namespace = kc.getContextObject(kc.getCurrentContext()).namespace;
        this.currentGateway = this.namespace + '-' + process.env.DEPLOYMENT_NAME
    }

    async listUsers() {
        return await this.customObjectsApi.listNamespacedCustomObject(
            apiGroup,
            apiGroupVersion,
            this.namespace,
            OIDCGWUsers
        ).then(async (r) => {
            // return new Account(r.body)
            return await Promise.all(
                r.body.items.map(async (s) => {
                    return new Account(s)
                })
            )
        }).catch((e) => {
            if (e.statusCode !== 404) {
                console.error(e)
                return null
            }
        })
    }

    async findUser(id) {
        return await this.customObjectsApi.getNamespacedCustomObject(
            apiGroup,
            apiGroupVersion,
            this.namespace,
            OIDCGWUsers,
            id
        ).then((r) => {
            return new Account(r.body)
        }).catch((e) => {
            if (e.statusCode !== 404) {
                console.error(e)
                return null
            }
        })
    }

    async findUserByEmails(emails) {
        const emailsInKube = []
        await this.customObjectsApi.listNamespacedCustomObject(
            apiGroup,
            apiGroupVersion,
            this.namespace,
            OIDCGWUsers
        ).then((r) => {
            r.body.items.map((f) => {
                f.spec.emails.map((e) => {
                    emailsInKube.push({
                        email: e,
                        user: f
                    })
                })
            })
        })
        const foundUser = emailsInKube.find((element) => {
            return emails.includes(element.email)
        })
        return foundUser ? new Account(foundUser.user) : null
    }

    async createUser(id, emails) {
        return await this.customObjectsApi.createNamespacedCustomObject(
            apiGroup,
            apiGroupVersion,
            this.namespace,
            OIDCGWUsers,
            {
                'apiVersion': apiGroup + '/' + apiGroupVersion,
                'kind': OIDCGWUser,
                'metadata': {
                    'name': id,
                },
                'spec': {
                    'emails': emails,
                    'githubProfile': {},
                    'customProfile': {},
                }

            }
        ).then(async (r) => {
            return await this.#updateUserStatus(new Account(r.body))
        }).catch((e) => {
            if (e.statusCode !== 404) {
                console.error(e)
                return null
            }
        })
    }

    async updateUserSpec({accountId, emails, customGroups, customProfile, githubGroups, githubProfile, acceptedTos} = {}) {
        const account = await this.findUser(accountId)
        let patches = []
        for (let [key, value] of Object.entries(arguments[0])) {
            patches = [...patches, ...this.#getPatches(key, value, account.spec)]
        }

        return await this.customObjectsApi.patchNamespacedCustomObject(
            apiGroup,
            apiGroupVersion,
            this.namespace,
            OIDCGWUsers,
            accountId,
            patches,
            undefined,
            undefined,
            undefined,
            { "headers": { "Content-type": k8s.PatchUtils.PATCH_FORMAT_JSON_PATCH}}
        ).then(async (r) => {
            return await this.#updateUserStatus(new Account(r.body))
        }).catch((e) => {
            if (e.statusCode !== 404) {
                console.error(e)
                return null
            }
        })
    }

    #getPatches (name, values, existingSpec) {
        let patches = []
        if (typeof values !== 'undefined') {
            const op = existingSpec?.[name] ? 'replace' : 'add'
            if (typeof values === 'object' && !Array.isArray(values)) {
                for (let [key, value] of Object.entries(values)) {
                    patches.push({
                        op,
                        "path": "/spec/" + name + '/' + key,
                        "value": value
                    })
                }
            } else {
                patches.push({
                    op,
                    "path":"/spec/" + name,
                    "value": values
                })
            }
        }
        return patches
    }

    async #updateUserStatus(account) {
        return await this.customObjectsApi.replaceNamespacedCustomObjectStatus(
            apiGroup,
            apiGroupVersion,
            this.namespace,
            OIDCGWUsers,
            account.accountId,
            {
                apiVersion: apiGroup + '/' + apiGroupVersion,
                kind: OIDCGWUser,
                metadata: {
                    name: account.accountId,
                    resourceVersion: account.resourceVersion
                },
                status: account.getIntendedStatus(),
            }
        ).then((r) => {
            return new Account(r.body)
        }).catch((e) => {
            console.error(e)
        })
    }
}
