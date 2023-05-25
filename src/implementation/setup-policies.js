import {interactionPolicy} from "oidc-provider";
import {ToSv1} from "../support/conditions/tosv1.js";
import {Approved} from "../support/conditions/approved.js";
import {clientId} from "../support/self-oidc-client.js";
import {updateSiteSession, validateSiteSession} from "../support/site-session.js";

export default () => {
    const { Prompt, Check, base } = interactionPolicy;
    const basePolicy = base()

    const approvalRequiredPolicy = new Prompt(
        { name: 'approval_required', requestable: false },
        new Check('approval_required', 'User needs to be approved', 'interaction_required', async (ctx) => {
                const { oidc, kubeOIDCUserService } = ctx;
                const kubeUser = await kubeOIDCUserService.findUser(oidc.session.accountId)
                return kubeUser.isAdmin ? Check.NO_NEED_TO_PROMPT : !kubeUser.checkCondition(new Approved())
            },
        ),
    )
    basePolicy.add(approvalRequiredPolicy, 1)

    const tosPolicy = new Prompt(
        { name: 'tos', requestable: true },
        new Check('tos_not_accepted', 'ToS needs to be accepted', 'interaction_required', async (ctx) => {
                const { oidc, kubeOIDCUserService } = ctx;
                const kubeUser = await kubeOIDCUserService.findUser(oidc.session.accountId)
                return !kubeUser.checkCondition(new ToSv1())
            },
        ),
    )
    basePolicy.add(tosPolicy, 2)

    const namePolicy = new Prompt(
        { name: 'name', requestable: true },
        new Check('name_required', 'User profile requires name', 'interaction_required', async (ctx) => {
                const { oidc, kubeOIDCUserService } = ctx;
                const kubeUser = await kubeOIDCUserService.findUser(oidc.session.accountId)
                return kubeUser.profile.name ? Check.NO_NEED_TO_PROMPT : Check.REQUEST_PROMPT;
            },
        ),
    )
    basePolicy.add(namePolicy, 3)

    const siteSessionCookieCheck = new Check('site_cookie_required', 'Site cookie required', 'interaction_required', async (ctx) => {
            const { oidc } = ctx;
            if (oidc.entities.Client.clientId === clientId) {
                if (!await validateSiteSession(ctx)) {
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
