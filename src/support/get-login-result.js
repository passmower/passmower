export default async (ctx, provider, account) => {
    const {params} = await provider.interactionDetails(ctx.req, ctx.res)
    const client = await provider.Client.find(params.client_id);
    console.log(client)
    if (client.allowedGroups && client.allowedGroups.length) {
        const accountGroups = account.getProfileResponse().groups.map(g => g.displayName)
        if (!client.allowedGroups.some(g => accountGroups.includes(g))) {
            return {
                error: 'access_denied',
                error_description: 'Insufficient permissions: Account does not have any of required groups',
            }
        }
    }

    return {
        login: {
            accountId: account.accountId,
        },
    }
}