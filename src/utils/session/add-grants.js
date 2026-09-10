export const addGrant = async (provider, prompt, grantId, accountId, client) => {
    // https://github.com/panva/node-oidc-provider/blob/main/example/routes/koa.js
    let grant;

    if (grantId) {
        // we'll be modifying existing grant in existing session
        grant = await provider.Grant.find(grantId);
    } else {
        // we're establishing a new grant
        grant = new provider.Grant({
            accountId,
            clientId: client.clientId,
        });
    }

    if (prompt.details.missingOIDCScope) {
        // offline_access is absent from missingOIDCScope unless the
        // authorization request carried prompt=consent, which OIDC Core §11
        // requires and oidc-provider enforces before the interaction. Adding it
        // to the grant does not put it into the code's scopes and so does not
        // make a refresh token issuable; it only lets the grant carry the scope
        // for a client allowed it. See docs/refresh-token-authorization.md.
        if (client.availableScopes.includes('offline_access')) {
            grant.addOIDCScope('offline_access')
        }
        grant.addOIDCScope(prompt.details.missingOIDCScope.join(' '));
    }
    if (prompt.details.missingOIDCClaims) {
        grant.addOIDCClaims(prompt.details.missingOIDCClaims);
    }
    if (prompt.details.missingResourceScopes) {
        for (const [indicator, scope] of Object.entries(prompt.details.missingResourceScopes)) {
            grant.addResourceScope(indicator, scope.join(' '));
        }
    }

    await grant.save();
    return grant
}
