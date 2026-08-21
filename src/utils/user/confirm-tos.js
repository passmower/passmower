import Account from "../../models/account.js";
import EmailAdapter from "../../adapters/email.js";
import {getText, ToSTextName} from "../get-text.js";
import {getEmailContent, getEmailSubject} from "../get-email-content.js";
import {isEmailEnabled} from '../email-configuration.js';
import {auditLog} from '../session/audit-log.js';

export const confirmTos = async (ctx, accountId, contentHash) => {
    let account = await Account.findAccount(ctx, accountId)
    const acceptedAt = new Date()
    await ctx.kubeOIDCUserService.mutateUserStatus(
        accountId,
        current => current.acceptTermsOfService(contentHash, acceptedAt),
    )

    if (!isEmailEnabled() || !account.primaryEmail) return
    try {
        const content = await getEmailContent('emails/tos', {
            name: account.profile.name,
            timestamp: acceptedAt,
            hash: contentHash,
            content: getText(ToSTextName)
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
}
