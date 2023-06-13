export const addGrant = async (provider, prompt, grantId, accountId, clientId) => {
    // https://github.com/panva/node-oidc-provider/blob/main/example/routes/koa.js
    let grant;

    if (grantId) {
        // we'll be modifying existing grant in existing session
        grant = await provider.Grant.find(grantId);
    } else {
        // we're establishing a new grant
        grant = new provider.Grant({
            accountId,
            clientId: clientId,
        });
    }

    if (prompt.details.missingOIDCScope) {
        const client = await provider.Client.find(clientId);
        if (client.availableScopes.includes('offline_access')) {
            // TODO: figure out why offline_access is stripped from missingOIDCScope.
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
