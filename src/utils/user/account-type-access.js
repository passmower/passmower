const ordinaryLoginTypes = new Set([null, 'person'])
const impersonationTypes = new Set([null, 'person', 'service'])

export const getAccountTypeAccessFailure = (account, {impersonation = false} = {}) => {
    if (!account) return 'account_missing'
    const type = account.type ?? null
    if (type === 'banned') return 'account_banned'
    const allowedTypes = impersonation ? impersonationTypes : ordinaryLoginTypes
    return allowedTypes.has(type) ? null : 'account_type_not_login_capable'
}

export const canImpersonateAccount = account =>
    getAccountTypeAccessFailure(account, {impersonation: true}) === null
