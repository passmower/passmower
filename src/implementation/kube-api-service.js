import {readFileSync} from "fs";
import * as k8s from "@kubernetes/client-node";
import Account from "../support/account.js";

const OIDCGWUser = 'OIDCGWUser';
const OIDCGWUsers = 'oidcgatewayusers';
const OIDCGWUserSpecProfileKey = 'profile';
const OIDCGWUserSpecAcceptedTosKey = 'acceptedTos';
const OIDCGWUserSpecGroupsKey = 'groups';
const OIDCGWUserSpecEmailsKey = 'emails';
const OIDCGWClients = 'oidcgatewayclients';
const apiGroup = 'codemowers.io'
const apiGroupVersion = 'v1alpha1'

export class KubeApiService {
    constructor() {
        const kc = new k8s.KubeConfig();
        kc.loadFromOptions({
            clusters: [{
                name: process.env.KUBE_CLUSTER_NAME,
                server: process.env.KUBE_CLUSTER_URL,
            }],
            users: [{
                name: process.env.KUBE_CLUSTER_NAME,
                token: readFileSync('/var/run/secrets/kubernetes.io/serviceaccount/token').toString(),
            }],
            contexts: [{
                name: process.env.KUBE_CLUSTER_NAME,
                user: process.env.KUBE_CLUSTER_NAME,
                cluster: process.env.KUBE_CLUSTER_NAME,
            }],
            currentContext: process.env.KUBE_CLUSTER_NAME,
        });
        this.k8sApi = kc.makeApiClient(k8s.CustomObjectsApi);
        this.namespace = process.env.KUBE_NAMESPACE;
    }

    async getClients() {
        return await this.k8sApi.listNamespacedCustomObject(
            apiGroup,
            apiGroupVersion,
            this.namespace,
            OIDCGWClients
        ).then((r) => {
            return r.body.items.map((c) => {
                return c.spec
            })
        })
    }

    async findUser(id) {
        return  await this.k8sApi.getNamespacedCustomObject(
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

    async createUser(id, profile, emails, groups) {
        return await this.k8sApi.createNamespacedCustomObject(
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
            console.error(r.body)
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
            // TODO: delete old groups
            patches.push({
                "op": "replace",
                "path":"/spec/" + OIDCGWUserSpecGroupsKey,
                "value": groups
            })
        }
        if (typeof emails !== 'undefined') {
            // TODO: delete old emails
            patches.push({
                "op": "replace",
                "path":"/spec/" + OIDCGWUserSpecEmailsKey,
                "value": emails
            })
        }

        return await this.k8sApi.patchNamespacedCustomObject(
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
            console.log(r.body)
            return new Account(r.body)
        }).catch((e) => {
            if (e.statusCode !== 404) {
                console.error(e)
                return null
            }
        })
    }
}
