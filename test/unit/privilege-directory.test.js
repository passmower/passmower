import {afterEach, describe, expect, it, vi} from 'vitest';
import Account from '../../src/models/account.js';
import {buildPrivilegeDirectory, getListedPrivilegeGroups} from '../../src/utils/user/privilege-directory.js';

function account(name, type, displayName, email, groups) {
    return new Account().fromKubernetes({
        metadata: {name},
        spec: {type},
        status: {
            primaryEmail: email,
            profile: {name: displayName},
            groups: groups.map(group => {
                const separator = group.indexOf(':')
                return {prefix: group.slice(0, separator), name: group.slice(separator + 1)}
            }),
        },
    })
}

afterEach(() => vi.unstubAllEnvs())

describe('privilege directory', () => {
    it('is private by default and de-duplicates configured groups', () => {
        expect(getListedPrivilegeGroups()).toEqual([])
        vi.stubEnv('PRIVILEGE_DIRECTORY_GROUPS', '["local:admin", "local:admin", "local:billing"]')
        expect(getListedPrivilegeGroups()).toEqual(['local:admin', 'local:billing'])
    })

    it('returns only people and only a refined member projection', () => {
        const users = [
            account('alice', 'person', 'Alice', 'alice@example.com', ['local:admin', 'private:group']),
            account('robot', 'service', 'Robot', 'robot@example.com', ['local:admin']),
            account('bob', 'person', 'Bob', 'bob@example.com', ['local:billing']),
        ]

        expect(buildPrivilegeDirectory(users, ['local:admin'])).toEqual([{
            group: 'local:admin',
            members: [{username: 'alice', name: 'Alice', email: 'alice@example.com'}],
        }])
    })
})
