import Account from "./account.js";
import selfOidcClient from "./self-oidc-client.js";
import renderError from "./render-error.js";
import loadExistingGrant from "./load-existing-grant.js";
import setupPolicies from "../implementation/setup-policies.js";

export default {
    findAccount: Account.findAccount,
    renderError,
    loadExistingGrant,
    interactions: {
        url(ctx, interaction) { // eslint-disable-line no-unused-vars
            return `/interaction/${interaction.uid}`;
        },
        policy: setupPolicies()
    },
    clients: [
        selfOidcClient,
    ],
    cookies: {
        keys: JSON.parse(process.env.OIDC_COOKIE_KEYS),
        names: {
            interaction: '_interaction',
            resume: '_interaction_resume',
            session: '_session',
            admin_session: '_admin_session',
            impersonation: '_impersonation',
        }
    },
    claims: {
        acr: null,
        auth_time: null,
        iss: null,
        openid: [
            'sub',
            'groups',
        ],
        profile: [
            'sub',
            'groups',
            'emails',
            'name',
            'company',
        ],
        sid: null,
    },
    features: {
        devInteractions: { enabled: false }, // defaults to true
        deviceFlow: { enabled: true }, // defaults to false
        revocation: { enabled: true }, // defaults to false
        rpInitiatedLogout: { enabled: false }, // defaults to true
    },
    ttl: {
        IdToken: 3600,
        Interaction: 3600,
        Session: 1209600,
        AdminSession: 3600,
        Impersonation: 3600,
    },
    jwks: {
        keys: JSON.parse(process.env.OIDC_JWKS),
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
    },
    extraClientMetadata: {
        properties: [
            'allowedGroups'
        ]
    }
};
