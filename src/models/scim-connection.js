export class ScimConnection {
    fromKubernetes(resource) {
        this.id = resource.metadata.name;
        this.uid = resource.metadata.uid ?? resource.metadata.name;
        this.resourceVersion = resource.metadata.resourceVersion;
        this.group = resource.spec.group;
        this.grantMode = resource.spec.grantMode ?? 'all-users';
        this.tokenHashes = resource.spec.tokenHashes ?? [];
        this.disabled = resource.spec.disabled === true;
        this.linking = resource.spec.linking ?? null;
        this.status = resource.status ?? {};
        // Source ownership follows the Kubernetes UID, not the reusable object
        // name. Deleting and recreating `acme` must not resurrect the deleted
        // connection's subjects or grants.
        this.sourceKey = `scim-${this.uid}`;
        return this;
    }
}

export default ScimConnection;
