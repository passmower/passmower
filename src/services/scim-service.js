import crypto from 'node:crypto';

export class ScimError extends Error {
    constructor(status, detail, scimType) {
        super(detail);
        this.status = status;
        this.scimType = scimType;
    }
}

function resourceId(kind, connectionId, externalId) {
    const digest = crypto.createHash('sha256').update(`${connectionId}\0${externalId}`).digest('hex').slice(0, 24);
    return `scim-${kind}-${digest}`;
}

function now() {
    return new Date().toISOString();
}

function emailsFrom(resource) {
    if (Array.isArray(resource.emails)) {
        return resource.emails
            .filter(email => email && typeof email.value === 'string')
            .map(email => ({email: email.value, primary: email.primary === true}));
    }
    return [];
}

export class ScimService {
    constructor(userService, connection, {baseUrl = `/scim/v2/${connection.id}`} = {}) {
        this.users = userService;
        this.connection = connection;
        this.sourceKey = connection.sourceKey;
        this.baseUrl = baseUrl.replace(/\/$/, '');
    }

    async listUsers() {
        return (await this.users.listUsers()).filter(account => account.type !== 'group' && account.getIdentity(this.sourceKey));
    }

    async listGroups() {
        return (await this.users.listUsers()).filter(account => {
            if (account.type !== 'group') return false;
            const identity = account.getIdentity(this.sourceKey);
            return identity && identity.active !== false;
        });
    }

    async findUser(id) {
        const account = await this.users.findUser(id);
        if (!account || account.type === 'group' || !account.getIdentity(this.sourceKey)) {
            throw new ScimError(404, `User ${id} was not found`);
        }
        return account;
    }

    async findGroup(id) {
        const account = await this.users.findUser(id);
        if (!account || account.type !== 'group' || !account.getIdentity(this.sourceKey) || account.getIdentity(this.sourceKey).active === false) {
            throw new ScimError(404, `Group ${id} was not found`);
        }
        return account;
    }

    async createUser(resource) {
        if (!resource || typeof resource.userName !== 'string' || !resource.userName.trim()) {
            throw new ScimError(400, 'userName is required', 'invalidValue');
        }
        const externalId = String(resource.externalId || resource.userName);
        const duplicate = (await this.listUsers()).find(account => {
            const identity = account.getIdentity(this.sourceKey);
            return identity.externalId === externalId || identity.userName === resource.userName;
        });
        if (duplicate) throw new ScimError(409, 'A user with that userName or externalId already exists', 'uniqueness');

        const id = resourceId('u', this.connection.uid, externalId);
        const createdAt = now();
        const identity = this.#userIdentity(resource, {externalId, createdAt});
        this.#projectGroups(identity);
        const account = await this.users.createProvisionedUser(id, {
            spec: {type: 'person'},
            identities: {[this.sourceKey]: identity},
        });
        if (!account) throw new ScimError(409, 'The provisioned user identifier already exists', 'uniqueness');
        return this.userResource(account);
    }

    async replaceUser(id, resource) {
        const account = await this.findUser(id);
        if (!resource || typeof resource.userName !== 'string' || !resource.userName.trim()) {
            throw new ScimError(400, 'userName is required', 'invalidValue');
        }
        const previous = account.getIdentity(this.sourceKey);
        const identity = this.#userIdentity(resource, {
            externalId: resource.externalId ?? previous.externalId,
            createdAt: previous.createdAt,
            sourceGroups: previous.sourceGroups ?? [],
        });
        this.#projectGroups(identity);
        const updated = await this.users.updateUserSpecs(id, {identities: {[this.sourceKey]: identity}});
        return this.userResource(updated);
    }

    async patchUser(id, operations) {
        const account = await this.findUser(id);
        const identity = structuredClone(account.getIdentity(this.sourceKey));
        for (const operation of operations ?? []) {
            const op = String(operation.op || '').toLowerCase();
            if (!['add', 'replace', 'remove'].includes(op)) throw new ScimError(400, `Unsupported PATCH operation ${operation.op}`, 'invalidSyntax');
            const path = operation.path?.toLowerCase();
            if (!path && operation.value && typeof operation.value === 'object') {
                Object.assign(identity, this.#patchableUserValues(operation.value, identity));
            } else if (path === 'active') {
                identity.active = op === 'remove' ? false : operation.value !== false;
            } else if (path === 'username') {
                if (op === 'remove') throw new ScimError(400, 'userName cannot be removed', 'mutability');
                identity.userName = String(operation.value);
            } else if (path === 'displayname') {
                if (op === 'remove') delete identity.displayName;
                else identity.displayName = String(operation.value);
            } else if (path === 'externalid') {
                if (op === 'remove') delete identity.externalId;
                else identity.externalId = String(operation.value);
            } else if (path?.startsWith('emails')) {
                // Entra addresses a single address as a sub-attribute path
                // (emails[type eq "work"].value) with a plain string value.
                // Map it onto the stored list instead of clearing it.
                if (op === 'remove') identity.emails = [];
                else if (path === 'emails') identity.emails = emailsFrom({emails: operation.value});
                else if (/^emails\[[^\]]*]\.value$/.test(path) && typeof operation.value === 'string') identity.emails = [{email: operation.value, primary: true}];
                else throw new ScimError(400, `Unsupported User PATCH path ${operation.path}`, 'invalidPath');
            } else {
                throw new ScimError(400, `Unsupported User PATCH path ${operation.path}`, 'invalidPath');
            }
        }
        identity.lastModified = now();
        this.#projectGroups(identity);
        const updated = await this.users.updateUserSpecs(id, {identities: {[this.sourceKey]: identity}});
        return this.userResource(updated);
    }

    async deactivateUser(id) {
        return this.patchUser(id, [{op: 'replace', path: 'active', value: false}]);
    }

    async createGroup(resource) {
        if (!resource || typeof resource.displayName !== 'string' || !resource.displayName.trim()) {
            throw new ScimError(400, 'displayName is required', 'invalidValue');
        }
        const externalId = String(resource.externalId || resource.displayName);
        if (Array.isArray(resource.members)) {
            const users = await this.listUsers();
            const unknown = resource.members.find(member => !users.some(user => user.accountId === String(member.value)));
            if (unknown) throw new ScimError(400, `Unknown member ${unknown.value}`, 'invalidValue');
        }
        const duplicate = (await this.listGroups()).find(account => {
            const identity = account.getIdentity(this.sourceKey);
            return identity.externalId === externalId || identity.displayName === resource.displayName;
        });
        if (duplicate) throw new ScimError(409, 'A group with that displayName or externalId already exists', 'uniqueness');

        const id = resourceId('g', this.connection.uid, externalId);
        // DELETE only tombstones a group record, so re-provisioning the same
        // externalId must reactivate the retained record rather than conflict
        // with it forever.
        const tombstoned = await this.users.findUser(id);
        if (tombstoned) {
            const previous = tombstoned.getIdentity(this.sourceKey);
            const identity = {
                resourceType: 'Group',
                externalId,
                displayName: resource.displayName,
                createdAt: previous?.createdAt ?? now(),
                lastModified: now(),
            };
            await this.users.updateUserSpecs(id, {identities: {[this.sourceKey]: identity}});
            await this.#replaceMembers(tombstoned, resource.members ?? []);
            return this.groupResource(await this.findGroup(id));
        }

        const createdAt = now();
        const identity = {
            resourceType: 'Group',
            externalId,
            displayName: resource.displayName,
            createdAt,
            lastModified: createdAt,
        };
        const account = await this.users.createProvisionedUser(id, {spec: {type: 'group'}, identities: {[this.sourceKey]: identity}});
        if (!account) throw new ScimError(409, 'The provisioned group identifier already exists', 'uniqueness');
        if (Array.isArray(resource.members) && resource.members.length) await this.#replaceMembers(account, resource.members);
        return this.groupResource(await this.findGroup(id));
    }

    async replaceGroup(id, resource) {
        const account = await this.findGroup(id);
        if (!resource || typeof resource.displayName !== 'string' || !resource.displayName.trim()) {
            throw new ScimError(400, 'displayName is required', 'invalidValue');
        }
        const identity = {...account.getIdentity(this.sourceKey), displayName: resource.displayName, externalId: resource.externalId ?? account.getIdentity(this.sourceKey).externalId, lastModified: now()};
        await this.users.updateUserSpecs(id, {identities: {[this.sourceKey]: identity}});
        await this.#replaceMembers(account, resource.members ?? []);
        return this.groupResource(await this.findGroup(id));
    }

    async patchGroup(id, operations) {
        let account = await this.findGroup(id);
        for (const operation of operations ?? []) {
            const op = String(operation.op || '').toLowerCase();
            const path = operation.path;
            if (!['add', 'replace', 'remove'].includes(op)) throw new ScimError(400, `Unsupported PATCH operation ${operation.op}`, 'invalidSyntax');
            if (!path && operation.value && typeof operation.value === 'object') {
                if (operation.value.displayName === undefined && operation.value.members === undefined) {
                    throw new ScimError(400, 'Unsupported Group PATCH value', 'invalidValue');
                }
                if (operation.value.displayName !== undefined) {
                    const identity = {...account.getIdentity(this.sourceKey), displayName: String(operation.value.displayName), lastModified: now()};
                    account = await this.users.updateUserSpecs(id, {identities: {[this.sourceKey]: identity}});
                }
                if (operation.value.members !== undefined) await this.#replaceMembers(account, operation.value.members ?? []);
            } else if (path?.toLowerCase() === 'displayname') {
                if (op === 'remove') throw new ScimError(400, 'displayName cannot be removed', 'mutability');
                const identity = {...account.getIdentity(this.sourceKey), displayName: String(operation.value), lastModified: now()};
                account = await this.users.updateUserSpecs(id, {identities: {[this.sourceKey]: identity}});
            } else if (path?.toLowerCase() === 'members') {
                if (op === 'replace') await this.#replaceMembers(account, operation.value ?? []);
                else if (op === 'add') await this.#addMembers(account, operation.value ?? []);
                else await this.#replaceMembers(account, []);
            } else {
                const match = path?.match(/^members\[value eq "([^"]+)"\]$/i);
                if (op === 'remove' && match) await this.#removeMembers(account, [match[1]]);
                else throw new ScimError(400, `Unsupported Group PATCH path ${path}`, 'invalidPath');
            }
        }
        return this.groupResource(await this.findGroup(id));
    }

    async deleteGroup(id) {
        const account = await this.findGroup(id);
        await this.#replaceMembers(account, []);
        const identity = {...account.getIdentity(this.sourceKey), active: false, lastModified: now()};
        await this.users.updateUserSpecs(id, {identities: {[this.sourceKey]: identity}});
    }

    userResource(account) {
        const identity = account.getIdentity(this.sourceKey);
        return {
            schemas: ['urn:ietf:params:scim:schemas:core:2.0:User'],
            id: account.accountId,
            externalId: identity.externalId,
            userName: identity.userName,
            displayName: identity.displayName ?? undefined,
            active: identity.active !== false,
            emails: (identity.emails ?? []).map(email => ({value: email.email, primary: email.primary === true})),
            meta: this.#meta('User', account, identity),
        };
    }

    async groupResource(account, users = null) {
        const identity = account.getIdentity(this.sourceKey);
        const members = this.#members(account, users ?? await this.listUsers())
            .map(user => ({value: user.accountId, $ref: `${this.baseUrl}/Users/${user.accountId}`, display: user.getIdentity(this.sourceKey).userName}));
        return {
            schemas: ['urn:ietf:params:scim:schemas:core:2.0:Group'],
            id: account.accountId,
            externalId: identity.externalId,
            displayName: identity.displayName,
            members,
            meta: this.#meta('Group', account, identity),
        };
    }

    #userIdentity(resource, defaults) {
        const displayName = resource.displayName ?? resource.name?.formatted;
        return {
            resourceType: 'User',
            externalId: defaults.externalId,
            userName: resource.userName,
            ...(displayName ? {displayName: String(displayName)} : {}),
            active: resource.active !== false,
            emails: emailsFrom(resource),
            sourceGroups: defaults.sourceGroups ?? [],
            createdAt: defaults.createdAt,
            lastModified: now(),
        };
    }

    #patchableUserValues(value, identity) {
        return {
            ...(value.userName !== undefined ? {userName: String(value.userName)} : {}),
            ...(value.displayName !== undefined ? {displayName: String(value.displayName)} : {}),
            ...(value.externalId !== undefined ? {externalId: String(value.externalId)} : {}),
            ...(value.active !== undefined ? {active: value.active !== false} : {}),
            ...(value.emails !== undefined ? {emails: emailsFrom(value)} : {}),
            sourceGroups: identity.sourceGroups ?? [],
        };
    }

    #meta(resourceType, account, identity) {
        return {
            resourceType,
            created: identity.createdAt,
            lastModified: identity.lastModified,
            version: `W/\"${account.resourceVersion}\"`,
            location: `${this.baseUrl}/${resourceType}s/${account.accountId}`,
        };
    }

    #members(group, users) {
        return users.filter(user => (user.getIdentity(this.sourceKey).sourceGroups ?? []).includes(group.accountId));
    }

    async #replaceMembers(group, members, users = null) {
        const desired = new Set((Array.isArray(members) ? members : []).map(member => String(member.value)));
        users = users ?? await this.listUsers();
        const unknown = [...desired].filter(id => !users.some(user => user.accountId === id));
        if (unknown.length) throw new ScimError(400, `Unknown member ${unknown[0]}`, 'invalidValue');
        for (const user of users) {
            const identity = structuredClone(user.getIdentity(this.sourceKey));
            const current = identity.sourceGroups ?? [];
            const has = current.includes(group.accountId);
            const wants = desired.has(user.accountId);
            if (wants && !has) identity.sourceGroups = [...current, group.accountId];
            else if (!wants && has) identity.sourceGroups = current.filter(item => item !== group.accountId);
            else continue;
            this.#projectGroups(identity);
            identity.lastModified = now();
            await this.users.updateUserSpecs(user.accountId, {identities: {[this.sourceKey]: identity}});
        }
    }

    async #addMembers(group, members) {
        const users = await this.listUsers();
        const existing = this.#members(group, users).map(user => user.accountId);
        const desired = [...new Set([...existing, ...(members ?? []).map(member => String(member.value))])];
        await this.#replaceMembers(group, desired.map(value => ({value})), users);
    }

    async #removeMembers(group, ids) {
        const remove = new Set(ids.map(String));
        const users = await this.listUsers();
        const existing = this.#members(group, users).map(user => user.accountId).filter(id => !remove.has(id));
        await this.#replaceMembers(group, existing.map(value => ({value})), users);
    }

    #projectGroups(identity) {
        const granted = identity.active !== false && (
            this.connection.grantMode === 'all-users' || (identity.sourceGroups ?? []).length > 0
        );
        identity.groups = granted ? [structuredClone(this.connection.group)] : [];
    }
}

export default ScimService;
