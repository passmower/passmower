import crypto from 'node:crypto';
import {SCIMConnectionCrd} from '../utils/kubernetes/kube-constants.js';
import ScimConnection from '../models/scim-connection.js';
import {ScimError} from './scim-service.js';

export function hashScimToken(token) {
    return crypto.createHash('sha256').update(token).digest('hex');
}

function equalHash(left, right) {
    const a = Buffer.from(String(left), 'hex');
    const b = Buffer.from(String(right), 'hex');
    return a.length === 32 && b.length === 32 && crypto.timingSafeEqual(a, b);
}

export class ScimConnectionService {
    constructor(adapter) {
        this.adapter = adapter;
    }

    async find(id) {
        const connection = await this.adapter.getNamespacedCustomObject(
            SCIMConnectionCrd,
            this.adapter.namespace,
            id,
            resource => new ScimConnection().fromKubernetes(resource),
        );
        if (!connection || connection.disabled) throw new ScimError(404, 'SCIM connection was not found');
        return connection;
    }

    async list() {
        const connections = await this.adapter.listNamespacedCustomObject(
            SCIMConnectionCrd,
            this.adapter.namespace,
            resource => new ScimConnection().fromKubernetes(resource),
        );
        return (connections ?? []).filter(connection => !connection.disabled);
    }

    authenticate(connection, token) {
        if (!token) return false;
        const presented = hashScimToken(token);
        return connection.tokenHashes.some(expected => equalHash(presented, expected));
    }
}

export default ScimConnectionService;
