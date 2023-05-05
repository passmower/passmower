export default async (ctx) => {
    // https://stackoverflow.com/questions/73581700/access-denied-after-interactionfinished-using-node-oidc-provider
    // https://github.com/panva/node-oidc-provider/blob/main/recipes/skip_consent.md
    const accountId = ctx.oidc.entities.Account.accountId
    const clientId = ctx.oidc.entities.Client.clientId
    const grant = new ctx.oidc.provider.Grant({
        accountId,
        clientId: clientId,
    });
    const scopes = ctx.oidc.entities.Client.availableScopes
    grant.addOIDCScope(scopes)
    await grant.save(); // We must save the grant so that the provider can use it when client accesses the userinfo endpoint.
    return grant;
}
