import Account from "../../models/account.js";
import {ToSv1} from "../../conditions/tosv1.js";
import EmailAdapter from "../../adapters/email.js";
import {getText, ToSTextName} from "../get-text.js";
import {getEmailContent, getEmailSubject} from "../get-email-content.js";

export const confirmTos = async (ctx, accountId, contentHash) => {
    let account = await Account.findAccount(ctx, accountId)
    let condition = new ToSv1()
    condition = condition.setStatus(true)
    account.addCondition(condition)
    await ctx.kubeOIDCUserService.updateUserStatus(account)

    const content = await getEmailContent('emails/tos', {
        name: account.profile.name,
        timestamp: new Date(),
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
}
