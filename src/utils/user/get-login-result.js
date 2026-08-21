import {auditLog} from "../session/audit-log.js";
import {getAccountTypeAccessFailure} from './account-type-access.js';

export default async (ctx, provider, account, method, {impersonation = false} = {}) => {
    const interactionDetails = await provider.interactionDetails(ctx.req, ctx.res)
    if (!account) {
        if (interactionDetails?.result?.requireCustomUsername) {
            return interactionDetails.result
        }
        auditLog(ctx, {interactionDetails, method}, 'Failed to log in user')
        return {
            error: 'access_denied',
            error_description: 'Account doesn\'t exist',
        };
    } else {
        const failure = getAccountTypeAccessFailure(account, {impersonation})
        if (failure) {
            auditLog(ctx, {interactionDetails, method, accountId: account.accountId,
                accountType: account.type, failure}, 'Account type is not allowed to log in')
            return {
                error: 'access_denied',
                error_description: 'This account cannot sign in',
            }
        }
        auditLog(ctx, {interactionDetails, method, account}, 'User logged in')
        return {
            login: {
                accountId: account.accountId,
            },
        };
    }
}
