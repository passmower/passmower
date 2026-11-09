const ordinaryLoginTypes = new Set([null, 'person'])
const impersonationTypes = new Set([null, 'person', 'service'])

export const getAccountTypeAccessFailure = (account, {impersonation = false} = {}) => {
    if (!account) return 'account_missing'
    const type = account.type ?? null
    if (type === 'banned') return 'account_banned'
    // Offboarding stage (#73): the account stays, with everything it owns,
    // but nothing may be done as it, impersonation included.
    if (account.disabled) return 'account_disabled'
    const allowedTypes = impersonation ? impersonationTypes : ordinaryLoginTypes
    return allowedTypes.has(type) ? null : 'account_type_not_login_capable'
}

export const canImpersonateAccount = account =>
    getAccountTypeAccessFailure(account, {impersonation: true}) === null
