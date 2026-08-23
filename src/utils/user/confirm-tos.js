import Account from "../../models/account.js";
import EmailAdapter from "../../adapters/email.js";
import {getEmailContent, getEmailSubject} from "../get-email-content.js";
import {isOutboundEmailEnabled} from '../email-configuration.js';
import {auditLog} from '../session/audit-log.js';
import {getTermsOfServiceDocument} from './tos-required.js';

export const confirmTos = async (ctx, accountId, contentHash) => {
    const document = getTermsOfServiceDocument()
    if (!document) return false
    if (document.contentHash !== contentHash) {
        const error = new Error('Terms of Service changed during acceptance')
        error.status = 409
        error.expose = true
        throw error
    }
    let account = await Account.findAccount(ctx, accountId)
    const acceptedAt = new Date()
    await ctx.kubeOIDCUserService.mutateUserStatus(
        accountId,
        current => current.acceptTermsOfService(contentHash, acceptedAt),
    )

    if (!isOutboundEmailEnabled() || !account.primaryEmail) return
    try {
        const content = await getEmailContent('emails/tos', {
            name: account.profile.name,
            timestamp: acceptedAt,
            hash: contentHash,
            content: document.text
        })
        const adapter = new EmailAdapter()
        await adapter.sendMail(
            account.primaryEmail,
            getEmailSubject('emails/tos'),
            content.text,
            content.html
        )
    } catch (error) {
        globalThis.logger?.error({error, accountId}, 'Failed to send Terms of Service receipt')
        auditLog(ctx, {accountId, error: error.message}, 'Terms of Service receipt delivery failed')
    }
    return true
}
