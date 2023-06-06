import {interactionPolicy} from "oidc-provider";
import {ToSv1} from "../support/conditions/tosv1.js";
import {Approved} from "../support/conditions/approved.js";
import {updateSiteSession, validateSiteSession} from "../support/site-session.js";
import {OIDCGWMiddlewareClient} from "../support/kube-constants.js";
import {checkAccountGroups} from "../support/check-account-groups.js";
import {clientId} from "../support/self-oidc-client.js";

export default () => {
    const { Prompt, Check, base } = interactionPolicy;
    const basePolicy = base()

    const approvalRequiredPolicy = new Prompt(
        { name: 'approval_required', requestable: false },
        new Check('approval_required', 'User needs to be approved', 'interaction_required', async (ctx) => {
                const { oidc, kubeOIDCUserService } = ctx;
                if (!ctx.currentAccount) {
                    // ctx.currentAccount is not properly available for new users.
                    ctx.currentAccount = await kubeOIDCUserService.findUser(oidc.session.accountId)
                }
                return ctx.currentAccount?.isAdmin ? Check.NO_NEED_TO_PROMPT : !ctx.currentAccount?.checkCondition(new Approved())
            },
        ),
    )
    basePolicy.add(approvalRequiredPolicy, 1)

    const namePolicy = new Prompt(
        { name: 'name', requestable: true },
        new Check('name_required', 'User profile requires name', 'interaction_required', async (ctx) => {
                return ctx.currentAccount?.profile?.name ? Check.NO_NEED_TO_PROMPT : Check.REQUEST_PROMPT;
            },
        ),
    )
    basePolicy.add(namePolicy, 2)

    const tosPolicy = new Prompt(
        { name: 'tos', requestable: true },
        new Check('tos_not_accepted', 'ToS needs to be accepted', 'interaction_required', async (ctx) => {
                return !ctx.currentAccount?.checkCondition(new ToSv1())
            },
        ),
    )
    basePolicy.add(tosPolicy, 3)

    const allowedGroupsPolicy = new Prompt(
        { name: 'groups_required', requestable: true },
        new Check('allowed_groups_required', 'Allowed groups required', 'interaction_required', async (ctx) => {
                const { oidc } = ctx;
                return !checkAccountGroups(oidc?.entities?.Client, ctx.currentAccount)
            },
        ),
    )
    basePolicy.add(allowedGroupsPolicy, 4)

    const siteSessionCookieCheck = new Check('site_cookie_required', 'Site cookie required', 'interaction_required', async (ctx) => {
            const { oidc } = ctx;
            if (oidc.entities.Client?.kind === OIDCGWMiddlewareClient || oidc.entities.Client?.clientId === clientId) {
                if (!await validateSiteSession(ctx, oidc.entities.Client.clientId)) {
                    return Check.REQUEST_PROMPT
                } else if (oidc.entities?.Interaction?.result?.siteSession) {
                    const siteSession = oidc.entities.Interaction.result.siteSession
                    siteSession.sessionId = oidc.entities.Session.jti
                    await updateSiteSession(siteSession)
                }
            }
            return Check.NO_NEED_TO_PROMPT
        },
    );
    const consentPolicy = basePolicy.get('consent')
    consentPolicy.checks.add(siteSessionCookieCheck)

    return basePolicy
}
