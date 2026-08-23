import ScimConnectionService from './scim-connection-service.js';
import ScimDirectoryService from './scim-directory-service.js';

export class ScimLinkService {
    constructor(adapter, userService) {
        this.adapter = adapter;
        this.users = userService;
        this.connections = new ScimConnectionService(adapter);
    }

    async linkAccount(providerKey, accountId, linkClaims) {
        if (!linkClaims || !Object.keys(linkClaims).length) return [];
        const linked = [];
        for (const connection of await this.connections.list()) {
            const rule = connection.linking;
            if (!rule || rule.provider !== providerKey) continue;
            if (String(linkClaims[rule.tenantClaim] ?? '') !== rule.tenantValue) continue;
            const externalId = String(linkClaims[rule.subjectClaim] ?? '');
            if (!externalId) continue;

            const directory = new ScimDirectoryService(this.adapter, connection);
            const subject = (await directory.listSubjects()).find(item => item.identity.externalId === externalId);
            if (!subject) continue;
            if (subject.linkedAccountId && subject.linkedAccountId !== accountId) {
                throw new Error(`SCIM subject ${subject.accountId} is already linked to another account`);
            }
            const updated = subject.linkedAccountId ? subject : await directory.linkSubject(subject, accountId);
            await this.project(connection, updated);
            linked.push(updated.accountId);
        }
        return linked;
    }

    async project(connection, subject) {
        if (!subject.linkedAccountId) return;
        const account = await this.users.findUser(subject.linkedAccountId);
        if (!account) throw new Error(`Linked OIDCUser ${subject.linkedAccountId} was not found`);
        await this.users.updateUserSpecs(subject.linkedAccountId, {
            identities: {
                [connection.sourceKey]: {
                    sub: subject.identity.externalId,
                    active: subject.identity.active !== false,
                    groups: subject.identity.groups ?? [],
                },
            },
        });
    }

    async revokeConnection(connection) {
        const directory = new ScimDirectoryService(this.adapter, connection);
        for (const subject of await directory.listSubjects()) {
            if (!subject.linkedAccountId) continue;
            const account = await this.users.findUser(subject.linkedAccountId);
            if (!account) continue;
            await this.users.updateUserSpecs(subject.linkedAccountId, {
                identities: {
                    [connection.sourceKey]: {
                        sub: subject.identity.externalId,
                        active: false,
                        groups: [],
                    },
                },
            });
        }
    }
}

export default ScimLinkService;
