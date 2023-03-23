class Account {
    constructor(apiResponse) {
        this.accountId = apiResponse.metadata.name;
        this.profile = apiResponse.spec.profile;
        this.acceptedTos = apiResponse.spec.acceptedTos
        this.groups = apiResponse.spec.groups
        this.emails = apiResponse.spec.emails
    }

    /**
     * @param use - can either be "id_token" or "userinfo", depending on
     *   where the specific claims are intended to be put in.
     * @param scope - the intended scope, while oidc-provider will mask
     *   claims depending on the scope automatically you might want to skip
     *   loading some claims from external resources etc. based on this detail
     *   or not return them in id tokens but only userinfo and so on.
     */
    async claims(use, scope) { // eslint-disable-line no-unused-vars
        if (this.profile) {
            return {
                sub: this.accountId, // it is essential to always return a sub claim
                groups: this.groups,
                emails: this.profile.emails,
                name: this.profile.name,
                company: this.profile.company,
                githubId: this.profile.githubId,
            };
        }
        return {
            sub: this.accountId, // it is essential to always return a sub claim
            groups: this.groups
        };
    }

    static async createOrUpdateByFederated(ctx, provider, sub, emails, profile) {
        if (!await ctx.kubeApiService.findUser(sub)) {
            return await ctx.kubeApiService.createUser(sub, profile, emails, undefined)
        }
        return await ctx.kubeApiService.updateUser(sub, profile, emails, undefined, undefined);
    }

    static async findAccount(ctx, id, token) { // eslint-disable-line no-unused-vars
        // token is a reference to the token used for which a given account is being loaded,
        // it is undefined in scenarios where account claims are returned from authorization endpoint
        // ctx is the koa request context
        const account = await ctx.kubeApiService.findUser(id)
        return account ? account : null
    }
}

export default Account;
