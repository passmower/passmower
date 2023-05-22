import {interactionPolicy} from "oidc-provider";
import {ToSv1} from "../support/conditions/tosv1.js";

export default () => {
    const { Prompt, Check, base } = interactionPolicy;

    const tosPolicy = new Prompt(
        { name: 'tos', requestable: true },
        new Check('tos_not_accepted', 'ToS needs to be accepted', 'interaction_required', async (ctx) => {
                const { oidc, kubeOIDCUserService } = ctx;
                const kubeUser = await kubeOIDCUserService.findUser(oidc.session.accountId)
                return !kubeUser.checkCondition(new ToSv1())
            },
        ),
    )

    const namePolicy = new Prompt(
        { name: 'name', requestable: true },
        new Check('name_required', 'User profile requires name', 'interaction_required', async (ctx) => {
                const { oidc, kubeOIDCUserService } = ctx;
                const kubeUser = await kubeOIDCUserService.findUser(oidc.session.accountId)
                return kubeUser.profile.name ? Check.NO_NEED_TO_PROMPT : Check.REQUEST_PROMPT;
            },
        ),
    )

    const basePolicy = base()
    basePolicy.add(tosPolicy)
    basePolicy.add(namePolicy)
    return basePolicy
}
