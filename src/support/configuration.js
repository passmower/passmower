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
        acr: null,
        auth_time: null,
        iss: null,
        openid: [
            'sub',
            'groups',
        ],
        sid: null,
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
