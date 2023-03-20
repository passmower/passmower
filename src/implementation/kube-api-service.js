import {readFileSync} from "fs";
import * as k8s from "@kubernetes/client-node";
import Account from "../support/account.js";

const OIDCGWUsers = 'oidcgatewayusers';
const OIDCGWClients = 'oidcgatewayclients';

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
        this.group = "codemowers.io";
        this.version = "v1alpha1";
        this.namespace = process.env.KUBE_NAMESPACE;
    }

    async getClients() {
        return await this.k8sApi.listNamespacedCustomObject(
            this.group,
            this.version,
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
            this.group,
            this.version,
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

    async createUser(id, profile) {
        return await this.k8sApi.createNamespacedCustomObject(
            this.group,
            this.version,
            this.namespace,
            OIDCGWUsers,
            {
                'apiVersion': 'codemowers.io/v1alpha1',
                'kind': 'OIDCGWUser',
                'metadata': {
                    'name': id,
                },
                'spec': {
                    'profile': profile
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

    async updateUser(id, profile, tos) {
        let patches = Object.keys(profile).map((k) => {
            return {
                "op": "replace",
                "path":"/spec/profile/" + k,
                "value": profile[k]
            }
        })
        if (typeof tos !== 'undefined') {
            patches.push({
                "op": "replace",
                "path":"/spec/acceptedTos",
                "value": tos
            })
        }

        return await this.k8sApi.patchNamespacedCustomObject(
            this.group,
            this.version,
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
