import {SCIMGroupCrd, SCIMSubjectCrd} from '../utils/kubernetes/kube-constants.js';
import ScimDirectoryResource from '../models/scim-directory-resource.js';

// Repository-shaped facade consumed by ScimService. SCIM directory objects are
// intentionally separate from OIDCUser: provisioning a directory record does
// not create a login-capable account or grant access before verified linking.
export class ScimDirectoryService {
    constructor(adapter, connection, {onChange} = {}) {
        this.adapter = adapter;
        this.connection = connection;
        this.namespace = adapter.namespace;
        this.onChange = onChange;
    }

    #map(kind) {
        return resource => new ScimDirectoryResource(this.connection, kind).fromKubernetes(resource);
    }

    async #list(kind) {
        const resources = await this.adapter.listNamespacedCustomObject(kind, this.namespace, this.#map(kind));
        return (resources ?? []).filter(resource => resource.connectionUid === this.connection.uid);
    }

    async listUsers() {
        return [...await this.#list(SCIMSubjectCrd), ...await this.#list(SCIMGroupCrd)];
    }

    async listSubjects() {
        return await this.#list(SCIMSubjectCrd);
    }

    async findUser(id) {
        for (const kind of [SCIMSubjectCrd, SCIMGroupCrd]) {
            const resource = await this.adapter.getNamespacedCustomObject(kind, this.namespace, id, this.#map(kind));
            if (resource?.connectionUid === this.connection.uid) return resource;
        }
        return null;
    }

    async createProvisionedUser(id, body) {
        const type = body.spec?.type;
        const kind = type === 'group' ? SCIMGroupCrd : SCIMSubjectCrd;
        const identity = body.identities?.[this.connection.sourceKey];
        if (!identity) throw new Error(`Missing identity for ${this.connection.sourceKey}`);
        const created = await this.adapter.createNamespacedCustomObject(
            kind,
            this.namespace,
            id,
            {
                spec: {
                    connectionRef: this.connection.id,
                    connectionUid: this.connection.uid,
                    identity,
                },
            },
            this.#map(kind),
            undefined,
            {
                'app.kubernetes.io/managed-by': 'passmower',
                'codemowers.cloud/scim-connection': this.connection.id,
            },
        );
        if (created && this.onChange) await this.onChange(created);
        return created;
    }

    async updateUserSpecs(id, body) {
        const resource = await this.findUser(id);
        if (!resource) throw new Error(`SCIM directory resource ${id} was not found`);
        const identity = body.identities?.[this.connection.sourceKey];
        if (!identity) throw new Error(`Missing identity for ${this.connection.sourceKey}`);
        const kind = resource.type === 'group' ? SCIMGroupCrd : SCIMSubjectCrd;
        const spec = {
            connectionRef: this.connection.id,
            connectionUid: this.connection.uid,
            identity,
        };
        const updated = await this.adapter.patchNamespacedCustomObject(
            kind,
            this.namespace,
            id,
            {spec},
            {spec: {connectionRef: this.connection.id, connectionUid: this.connection.uid, identity: resource.identity}},
            this.#map(kind),
        );
        if (!updated) throw new Error(`Failed to update SCIM directory resource ${id}`);
        if (this.onChange) await this.onChange(updated);
        return updated;
    }

    async linkSubject(subject, accountId) {
        if (subject.type === 'group') throw new Error('A SCIM group cannot be linked to an account');
        const status = {...subject.status, accountId};
        const updated = await this.adapter.replaceNamespacedCustomObjectStatus(
            SCIMSubjectCrd,
            this.namespace,
            subject.accountId,
            subject.resourceVersion,
            status,
            this.#map(SCIMSubjectCrd),
        );
        if (!updated) throw new Error(`Failed to link SCIM subject ${subject.accountId}`);
        return updated;
    }
}

export default ScimDirectoryService;
