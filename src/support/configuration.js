export default {
    interactions: {
        url(ctx, interaction) { // eslint-disable-line no-unused-vars
            return `/interaction/${interaction.uid}`;
        },
    },
    cookies: {
        keys: ['some secret key', 'and also the old rotated away some time ago', 'and one more'],
    },
    claims: {
        address: ['address'],
        email: ['email', 'email_verified'],
        phone: ['phone_number', 'phone_number_verified'],
        profile: ['birthdate', 'family_name', 'gender', 'given_name', 'locale', 'middle_name', 'name',
            'nickname', 'picture', 'preferred_username', 'profile', 'updated_at', 'website', 'zoneinfo'],
    },
    features: {
        devInteractions: { enabled: false }, // defaults to true
        deviceFlow: { enabled: true }, // defaults to false
        revocation: { enabled: true }, // defaults to false
    },
    loadExistingGrant: async (ctx) => {
        const accountId = ctx.oidc.entities.Account.accountId
        const clientId = ctx.oidc.entities.Client.clientId
        const grant = new ctx.oidc.provider.Grant({
            accountId,
            clientId: clientId,
        });
        grant.addOIDCScope('openid')
        // TODO: manage the grant according to upstream, if needed.
        return grant
    },
    jwks: {
        keys: [],
    },
};
