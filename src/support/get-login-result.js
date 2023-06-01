export default async (ctx, provider, account) => {
    return {
        login: {
            accountId: account.accountId,
        },
    }
}
