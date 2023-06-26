import {auditLog} from "./audit-log.js";

export default async (ctx, provider, account, method) => {
    const interactionDetails = await provider.interactionDetails(ctx.req, ctx.res)
    if (!account) {
        auditLog(ctx, {interactionDetails, method}, 'Failed to log in user')
        return {
            error: 'access_denied',
            error_description: 'Account doesn\'t exist',
        };
    } else {
        auditLog(ctx, {interactionDetails, method, account}, 'User logged in')
        return {
            login: {
                accountId: account.accountId,
            },
        };
    }
}
