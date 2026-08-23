export const checkAccountGroups = (client, account) => {
    const allowedUsers = client?.allowedUsers ?? []
    const allowedGroups = client?.allowedGroups ?? []
    if (!allowedUsers.length && !allowedGroups.length) return true
    if (allowedUsers.includes(account.accountId)) return true
    const accountGroups = (account.groups ?? []).map(g => `${g.prefix}:${g.name}`)
    return allowedGroups.some(group => accountGroups.includes(group))
}
