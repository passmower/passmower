import Account from "./account.js";
import {ToSv1} from "./conditions/tosv1.js";

export const confirmTos = async (ctx, accountId) => {
    let account = await Account.findAccount(ctx, accountId)
    let condition = new ToSv1()
    condition = condition.setStatus(true)
    account.addCondition(condition.toKubeCondition())
    await ctx.kubeOIDCUserService.updateUserStatus(account)
}
