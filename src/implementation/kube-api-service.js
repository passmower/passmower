import * as k8s from "@kubernetes/client-node";
import Account from "../support/account.js";
import {
    OIDCGWUser,
    OIDCGWUsers,
    OIDCGWUserSpecProfileKey,
    OIDCGWUserSpecAcceptedTosKey,
    OIDCGWUserSpecGroupsKey,
    OIDCGWUserSpecEmailsKey,
    apiGroup,
    apiGroupVersion
} from "../support/kube-constants.js";

export class KubeApiService {
    constructor() {
        const kc = new k8s.KubeConfig();
        this.kc = kc
        kc.loadFromCluster()
        this.customObjectsApi = kc.makeApiClient(k8s.CustomObjectsApi);
        this.coreV1Api = kc.makeApiClient(k8s.CoreV1Api);
        this.namespace = kc.getContextObject(kc.getCurrentContext()).namespace;
        this.currentGateway = this.namespace + '-' + process.env.DEPLOYMENT_NAME
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

    async createUser(id, profile, emails, groups) {
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
                    'profile': profile,
                    'groups': groups,
                    'emails': emails,
                }
            }
        ).then((r) => {
            return new Account(r.body)
        }).catch((e) => {
            if (e.statusCode !== 404) {
                console.error(e)
                return null
            }
        })
    }

    async updateUser(id, profile, emails, groups, tos) {
        let patches = Object.keys(profile).map((k) => {
            return {
                "op": "replace",
                "path":"/spec/" + OIDCGWUserSpecProfileKey + '/' + k,
                "value": profile[k]
            }
        })
        if (typeof tos !== 'undefined') {
            patches.push({
                "op": "replace",
                "path":"/spec/" + OIDCGWUserSpecAcceptedTosKey,
                "value": tos
            })
        }
        if (typeof groups !== 'undefined') {
            patches.push({
                "op": "replace",
                "path":"/spec/" + OIDCGWUserSpecGroupsKey,
                "value": groups
            })
        }
        if (typeof emails !== 'undefined') {
            patches.push({
                "op": "replace",
                "path":"/spec/" + OIDCGWUserSpecEmailsKey,
                "value": emails
            })
        }

        return await this.customObjectsApi.patchNamespacedCustomObject(
            apiGroup,
            apiGroupVersion,
            this.namespace,
            OIDCGWUsers,
            id,
            patches,
            undefined,
            undefined,
            undefined,
            { "headers": { "Content-type": k8s.PatchUtils.PATCH_FORMAT_JSON_PATCH}}
        ).then((r) => {
            return new Account(r.body)
        }).catch((e) => {
            if (e.statusCode !== 404) {
                console.error(e)
                return null
            }
        })
    }
}
