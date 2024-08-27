export const checkAccountGroups = (client, account) => {
    if (client?.allowedGroups && client?.allowedGroups.length) {
        const accountGroups = account.getProfileResponse().groups.map(g => g.displayName)
        if (!client.allowedGroups.some(g => accountGroups.includes(g))) {
            return false
        }
    }
    return true
}
