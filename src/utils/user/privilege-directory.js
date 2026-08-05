export function getListedPrivilegeGroups(value = process.env.PRIVILEGE_DIRECTORY_GROUPS) {
    if (!value) return []
    try {
        const groups = JSON.parse(value)
        if (!Array.isArray(groups)) throw new TypeError('expected a JSON array')
        return [...new Set(groups.map(group => String(group).trim()).filter(Boolean))]
    } catch (error) {
        globalThis.logger?.warn({error}, 'Ignoring invalid PRIVILEGE_DIRECTORY_GROUPS; expected a JSON array')
        return []
    }
}

export function buildPrivilegeDirectory(accounts, groups = getListedPrivilegeGroups()) {
    return groups.map(group => ({
        group,
        members: accounts
            .filter(account => account.type === null || account.type === 'person')
            .filter(account => account.groups.some(item => `${item.prefix}:${item.name}` === group))
            .map(account => ({
                username: account.accountId,
                name: account.profile.name,
                email: account.primaryEmail,
            }))
            .sort((a, b) => (a.name ?? a.username).localeCompare(b.name ?? b.username)),
    }))
}
