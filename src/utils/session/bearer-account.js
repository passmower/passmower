import Account from "../../models/account.js";

// Resolves the Account behind a Bearer access token, enforcing an optional required scope.
// Returns { account, scopes } on success, or { status } carrying an HTTP error code.
export const accountFromBearer = async (ctx, provider, requiredScope = null) => {
    const header = ctx.headers.authorization || ''
    const [scheme, token] = header.split(' ')
    if (scheme !== 'Bearer' || !token) {
        return {status: 401}
    }
    const accessToken = await provider.AccessToken.find(token)
    if (!accessToken) {
        return {status: 401}
    }
    const scopes = new Set((accessToken.scope || '').split(' ').filter(Boolean))
    if (requiredScope && !scopes.has(requiredScope)) {
        return {status: 403}
    }
    const account = await Account.findAccount(ctx, accessToken.accountId)
    if (!account) {
        return {status: 401}
    }
    return {account, scopes}
}
