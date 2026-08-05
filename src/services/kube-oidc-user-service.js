import Account from "../models/account.js";
import {KubernetesAdapter} from "../adapters/kubernetes.js";
import {OIDCUserCrd} from "../utils/kubernetes/kube-constants.js";
import {ClaimedBy} from "../conditions/claimed-by.js";
import mergeWith from "lodash/mergeWith.js";
import cloneDeep from "lodash/cloneDeep.js";
import isArray from "lodash/isArray.js";
import {assessEmailOwnership, canonicalizeEmail, IdentityIntegrityError} from '../utils/user/identity-integrity.js';

// Custom merge that replaces arrays instead of merging by index
function mergeReplacingArrays(objValue, srcValue) {
    if (isArray(srcValue)) {
        return srcValue;
    }
}

export class KubeOIDCUserService {
    constructor(adapter = new KubernetesAdapter()) {
        this.adapter = adapter
    }

    async listUsers() {
        return await this.adapter.listNamespacedCustomObject(
            OIDCUserCrd,
            this.adapter.namespace,
            (apiResponse) => (new Account()).fromKubernetes(apiResponse)
        )
    }

    async findUser(id, ctx) {
        return await this.adapter.getNamespacedCustomObject(
            OIDCUserCrd,
            this.adapter.namespace,
            id,
            (apiResponse) => (new Account()).fromKubernetes(apiResponse).setContext(ctx)
        )
    }

    async findUserByEmails(emails, users) {
        const allUsers = users ?? await this.listUsers()
        const ownership = assessEmailOwnership(allUsers)
        const candidates = [...new Set(emails.map(canonicalizeEmail).filter(Boolean)
            .map(email => ownership.owners.get(email)).filter(Boolean))]
        if (candidates.length > 1) {
            throw new IdentityIntegrityError('Incoming emails belong to different OIDC users', {
                accountIds: candidates.map(account => account.accountId),
            })
        }
        const account = candidates[0]
        if (account && !ownership.isEligible(account)) {
            throw new IdentityIntegrityError(`OIDCUser ${account.accountId} has conflicting email claims`, {
                accountId: account.accountId,
                conflicts: ownership.conflicts.get(account.accountId),
            })
        }
        return account
    }

    async findUserByIdentity(providerKey, subject, users) {
        return this.#findUniqueStableIdentity(
            account => account.getIdentity(providerKey)?.sub === subject,
            `${providerKey} subject ${subject}`,
            users,
        )
    }

    async findUserByGithubId(githubId, users) {
        return this.#findUniqueStableIdentity(
            account => String(account.getGithubId()) === String(githubId),
            `GitHub id ${githubId}`,
            users,
        )
    }

    async #findUniqueStableIdentity(predicate, description, users) {
        const allUsers = users ?? await this.listUsers()
        const matches = allUsers.filter(predicate)
        if (matches.length > 1) {
            throw new IdentityIntegrityError(`${description} is attached to multiple OIDC users`, {
                accountIds: matches.map(account => account.accountId),
            })
        }
        const account = matches[0]
        if (!account) return undefined
        const ownership = assessEmailOwnership(allUsers)
        if (!ownership.isEligible(account)) {
            throw new IdentityIntegrityError(`OIDCUser ${account.accountId} has conflicting email claims`, {
                accountId: account.accountId,
                conflicts: ownership.conflicts.get(account.accountId),
            })
        }
        return account
    }

    async reconcileEmailUniqueness() {
        const accounts = await this.listUsers()
        const ownership = assessEmailOwnership(accounts)
        let conflictedUsers = 0
        const errors = []
        for (const account of accounts) {
            const conflicts = ownership.conflicts.get(account.accountId) ?? []
            if (conflicts.length) conflictedUsers++
            const previous = account.getConditions().find(condition => condition.type === 'EmailUnique')
            const status = conflicts.length ? 'False' : 'True'
            const reason = conflicts.length ? 'DuplicateEmail' : 'Unique'
            const message = conflicts.length
                ? conflicts.map(conflict => `${conflict.email} is owned by OIDCUser ${conflict.ownerAccountId}`).join('; ')
                : 'All claimed email addresses are unique'
            if (previous?.status === status && previous?.reason === reason && previous?.message === message) continue
            const condition = {
                apiVersion: 'v1',
                kind: 'Condition',
                type: 'EmailUnique',
                status,
                reason,
                message,
                lastTransitionTime: previous?.status === status ? previous.lastTransitionTime : new Date(),
            }
            account.setConditions([
                ...account.getConditions().filter(item => item.type !== 'EmailUnique'),
                condition,
            ])
            try {
                const updated = await this.updateUserStatus(account)
                if (!updated) throw new Error(`Status update returned no OIDCUser for ${account.accountId}`)
                if (status === 'False' && previous?.status !== 'False') {
                    await this.adapter.createEvent?.(
                        this.adapter.namespace,
                        account.getMetadata(),
                        'DuplicateEmail',
                        message,
                    )
                }
            } catch (error) {
                errors.push(error)
            }
        }
        globalThis.metrics?.oidcUserEmailConflicts?.set(conflictedUsers)
        if (errors.length) throw new AggregateError(errors, `Failed to reconcile ${errors.length} OIDCUser email condition(s)`)
        return {accounts, ownership, conflictedUsers}
    }

    async createUser(id, email, githubEmails) {
        const user = await this.adapter.createNamespacedCustomObject(
            OIDCUserCrd,
            this.adapter.namespace,
            id,
            {
                spec: {},
                passmower: {
                    email
                },
                github: {
                    emails: githubEmails
                }
            },
            (apiResponse) => (new Account()).fromKubernetes(apiResponse),
            undefined,
            (new ClaimedBy(this.adapter.instance)).setStatus(true).toLabels(),
        )
        // Create can fail (e.g. the name is already taken) — the adapter
        // swallows the error and returns null. Don't try to set status on a
        // user that wasn't created; let the caller handle the failure.
        if (!user) {
            return null
        }
        return await this.updateUserStatus(user)
    }

    async updateUserSpecs(accountId, {passmower, slack, github, identities} = {}) {
        let account = await this.findUser(accountId)
        if (!account) {
            throw new Error(`updateUserSpecs: user "${accountId}" not found`)
        }
        let extended = mergeWith(cloneDeep(account.getSpecs()), arguments[1], mergeReplacingArrays)
        const updatedUser = await this.adapter.patchNamespacedCustomObject(
            OIDCUserCrd,
            this.adapter.namespace,
            accountId,
            extended,
            account.getSpecs(),
            (apiResponse) => (new Account()).fromKubernetes(apiResponse)
        )
        // The adapter swallows API errors and returns null. Surface that as a
        // clear error instead of NPE-ing later in updateUserStatus.
        if (!updatedUser) {
            throw new Error(`updateUserSpecs: Kubernetes rejected the spec patch for user "${accountId}"`)
        }
        return await this.updateUserStatus(updatedUser)
    }

    async replaceUserLabels(updatedUser) {
        await this.adapter.patchNamespacedCustomObject(
            OIDCUserCrd,
            this.adapter.namespace,
            updatedUser.accountId,
            {
                ['/metadata']: {
                    labels: updatedUser.getLabels()
                }
            },
            {
                ['/metadata']: {
                    labels: updatedUser.getLabels()
                }
            },
            (apiResponse) => (new Account()).fromKubernetes(apiResponse)
        )
    }

    async updateUserStatus(account) {
        if (!account) {
            throw new Error('updateUserStatus: account is null (user creation or spec patch failed upstream)')
        }
        return await this.adapter.replaceNamespacedCustomObjectStatus(
            OIDCUserCrd,
            this.adapter.namespace,
            account.accountId,
            account.resourceVersion,
            account.getIntendedStatus(),
            (apiResponse) => (new Account()).fromKubernetes(apiResponse)
        )
    }

    // WebAuthn/Passkey methods

    /**
     * Find a user by their passkey credential ID
     * @param {string} credentialId - Base64URL-encoded credential ID
     * @returns {Promise<Account|null>}
     */
    async findUserByPasskeyId(credentialId) {
        const allUsers = await this.listUsers();
        return allUsers.find(user =>
            user.webauthn?.credentials?.some(cred => cred.id === credentialId)
        ) || null;
    }

    /**
     * Add a new passkey to a user's account
     * @param {string} accountId
     * @param {object} credential - The credential to add
     */
    async addPasskey(accountId, credential) {
        const account = await this.findUser(accountId);
        const existingCredentials = account.webauthn?.credentials || [];

        // Ensure we don't add duplicate credentials
        if (existingCredentials.some(c => c.id === credential.id)) {
            throw new Error('Credential already exists');
        }

        const updatedWebauthn = {
            webauthn: {
                credentials: [...existingCredentials, credential]
            }
        };

        return await this.updateUserSpecs(accountId, updatedWebauthn);
    }

    /**
     * Remove a passkey from a user's account
     * @param {string} accountId
     * @param {string} credentialId - Base64URL-encoded credential ID
     */
    async removePasskey(accountId, credentialId) {
        const account = await this.findUser(accountId);
        const existingCredentials = account.webauthn?.credentials || [];

        const updatedCredentials = existingCredentials.filter(c => c.id !== credentialId);

        if (updatedCredentials.length === existingCredentials.length) {
            throw new Error('Credential not found');
        }

        const updatedWebauthn = {
            webauthn: {
                credentials: updatedCredentials
            }
        };

        return await this.updateUserSpecs(accountId, updatedWebauthn);
    }

    /**
     * Rename a passkey
     * @param {string} accountId
     * @param {string} credentialId
     * @param {string} newName
     */
    async renamePasskey(accountId, credentialId, newName) {
        const account = await this.findUser(accountId);
        const existingCredentials = account.webauthn?.credentials || [];

        const credIndex = existingCredentials.findIndex(c => c.id === credentialId);
        if (credIndex === -1) {
            throw new Error('Credential not found');
        }

        const updatedCredentials = [...existingCredentials];
        updatedCredentials[credIndex] = {
            ...updatedCredentials[credIndex],
            name: newName
        };

        const updatedWebauthn = {
            webauthn: {
                credentials: updatedCredentials
            }
        };

        return await this.updateUserSpecs(accountId, updatedWebauthn);
    }

    /**
     * Update the counter for a passkey (for replay attack protection)
     * @param {string} accountId
     * @param {string} credentialId
     * @param {number} newCounter
     */
    async updatePasskeyCounter(accountId, credentialId, newCounter) {
        const account = await this.findUser(accountId);
        const existingCredentials = account.webauthn?.credentials || [];

        const credIndex = existingCredentials.findIndex(c => c.id === credentialId);
        if (credIndex === -1) {
            throw new Error('Credential not found');
        }

        const updatedCredentials = [...existingCredentials];
        updatedCredentials[credIndex] = {
            ...updatedCredentials[credIndex],
            counter: newCounter
        };

        const updatedWebauthn = {
            webauthn: {
                credentials: updatedCredentials
            }
        };

        return await this.updateUserSpecs(accountId, updatedWebauthn);
    }
}
