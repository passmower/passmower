export class ScimDirectoryResource {
    constructor(connection, kind) {
        this.connection = connection;
        this.kind = kind;
    }

    fromKubernetes(resource) {
        this.accountId = resource.metadata.name;
        this.resourceVersion = resource.metadata.resourceVersion;
        this.type = this.kind === 'SCIMGroup' ? 'group' : 'person';
        this.identity = resource.spec.identity;
        this.connectionUid = resource.spec.connectionUid;
        this.linkedAccountId = resource.status?.accountId ?? null;
        this.status = resource.status ?? {};
        return this;
    }

    getIdentity(sourceKey) {
        return sourceKey === this.connection.sourceKey && this.connectionUid === this.connection.uid
            ? this.identity
            : null;
    }
}

export default ScimDirectoryResource;
