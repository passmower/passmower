import {auditLog} from "../session/audit-log.js";
import {getAccountTypeAccessFailure} from './account-type-access.js';
import {parseRequestMetadata} from '../session/parse-request-headers.js';
import {loginNotificationsEnabled, notifyAccount} from '../../services/notification-service.js';

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
        // Impersonated sign-ins are announced by the dedicated impersonation
        // notification instead. Fire-and-forget: notifyAccount never rejects.
        if (!impersonation && loginNotificationsEnabled()) {
            const request = parseRequestMetadata(ctx.headers)
            const os = request.os?.startsWith('undefined') ? undefined : request.os
            const location = [request.ip && `from ${request.ip}`,
                request.browser && `using ${request.browser}`,
                os && `on ${os}`].filter(Boolean).join(' ')
            void notifyAccount(account,
                `New sign-in to ${new URL(process.env.ISSUER_URL).host}`,
                `Your account ${account.accountId} signed in via ${method}${location ? ' ' + location : ''}. If this was not you, end your sessions on your profile page and contact an administrator.`)
        }
        return {
            login: {
                accountId: account.accountId,
            },
        };
    }
}
