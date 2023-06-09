export default async (ctx, provider, account) => {
    if (!account) {
        return {
            error: 'access_denied',
            error_description: 'Account doesn\'t exist',
        };
    } else {
        return {
            login: {
                accountId: account.accountId,
            },
        };
    }
}
