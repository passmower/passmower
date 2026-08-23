import {KubernetesAdapter} from '../adapters/kubernetes.js';
import ScimConnection from '../models/scim-connection.js';
import {KubeOIDCUserService} from '../services/kube-oidc-user-service.js';
import ScimLinkService from '../services/scim-link-service.js';
import {SCIMConnectionCrd, SCIMGroupCrd, SCIMSubjectCrd} from '../utils/kubernetes/kube-constants.js';
import {NamespaceFilter} from '../utils/kubernetes/namespace-filter.js';

export class KubeScimConnectionOperator {
    constructor(adapter = new KubernetesAdapter()) {
        this.adapter = adapter;
        this.linker = new ScimLinkService(adapter, new KubeOIDCUserService(adapter));
    }

    async watchConnections() {
        this.adapter.setWatchParameters(
            SCIMConnectionCrd,
            resource => new ScimConnection().fromKubernetes(resource),
            connection => this.#reconcile(connection),
            connection => this.#reconcile(connection),
            connection => this.linker.revokeConnection(connection),
            new NamespaceFilter(this.adapter.namespace),
        );
        await this.adapter.watchObjects();
    }

    async #reconcile(connection) {
        if (connection.disabled) await this.linker.revokeConnection(connection);
        const [subjects, groups] = await Promise.all([
            this.adapter.listNamespacedCustomObject(SCIMSubjectCrd, this.adapter.namespace, resource => resource),
            this.adapter.listNamespacedCustomObject(SCIMGroupCrd, this.adapter.namespace, resource => resource),
        ]);
        const belongsToConnection = resource => resource.spec?.connectionUid === connection.uid;
        const status = {
            ...connection.status,
            userCount: (subjects ?? []).filter(belongsToConnection).length,
            groupCount: (groups ?? []).filter(belongsToConnection).length,
            conditions: [{
                type: 'Ready',
                status: connection.disabled ? 'False' : 'True',
                reason: connection.disabled ? 'Disabled' : 'Available',
            }],
        };

        // Compare only the fields this operator owns — key order elsewhere in
        // status must not trigger rewrites on every watch event.
        const current = connection.status ?? {};
        if (current.userCount === status.userCount
            && current.groupCount === status.groupCount
            && JSON.stringify(current.conditions) === JSON.stringify(status.conditions)) return;
        await this.adapter.replaceNamespacedCustomObjectStatus(
            SCIMConnectionCrd,
            this.adapter.namespace,
            connection.id,
            connection.resourceVersion,
            status,
            resource => new ScimConnection().fromKubernetes(resource),
        );
    }
}

export default KubeScimConnectionOperator;
