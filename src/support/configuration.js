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
        rpInitiatedLogout: { enabled: false }, // defaults to true
    },
    loadExistingGrant: async (ctx) => {
        // https://stackoverflow.com/questions/73581700/access-denied-after-interactionfinished-using-node-oidc-provider
        // https://github.com/panva/node-oidc-provider/blob/main/recipes/skip_consent.md
        const accountId = ctx.oidc.entities.Account.accountId
        const clientId = ctx.oidc.entities.Client.clientId
        const grant = new ctx.oidc.provider.Grant({
            accountId,
            clientId: clientId,
        });
        grant.addOIDCScope('openid profile')
        // TODO: add other OIDCScopes, OIDCClaims and resourceScopes, dynamically or via OIDCGWClient CRD.
        await grant.save(); // We must save the grant so that the provider can use it when client accesses the userinfo endpoint.
        return grant;
    },
    ttl: {
        IdToken: 3600,
        Interaction: 3600,
        Session: 1209600
    },
    jwks: {
        keys: [],
    },
    clientDefaults: {
        grant_types: [
            'authorization_code'
        ],
        id_token_signed_response_alg: 'RS256',
        response_types: [
            'code'
        ],
        token_endpoint_auth_method: 'client_secret_basic'
    }
};
