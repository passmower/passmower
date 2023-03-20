import {interactionPolicy} from "oidc-provider";

export default (kubeApiService) => {
    const { Prompt, Check, base } = interactionPolicy;

    const tosPolicy = new Prompt(
        { name: 'tos', requestable: true },
        new Check('tos_not_accepted', 'ToS needs to be accepted', 'interaction_required', async (ctx) => {
                const { oidc } = ctx;
                const kubeUser = await kubeApiService.findUser(oidc.session.accountId)
                return kubeUser.acceptedTos ? Check.NO_NEED_TO_PROMPT : Check.REQUEST_PROMPT;
            },
        ),
    )

    const basePolicy = base()
    basePolicy.add(tosPolicy)
    return basePolicy
}