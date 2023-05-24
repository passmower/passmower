import RedisAdapter from "../adapters/redis.js";

export const addGrant = async (provider, accountId, clientId) => {
    const grant = new provider.Grant({
        accountId,
        clientId,
        test: 'dsa'
    });
    const redis = new RedisAdapter('Client')
    const client = await redis.find(clientId)
    grant.addOIDCScope(client.availableScopes)
    await grant.save();
    return grant
}
