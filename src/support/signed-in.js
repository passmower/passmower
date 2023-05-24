export const signedInSession = async (ctx, provider) => {
    const session = await provider.Session.get(ctx)
    return (!!session.accountId && !!session.authorizations) ? session : false
}
