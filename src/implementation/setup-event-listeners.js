export default (provider) => {
    // https://github.com/panva/node-oidc-provider/blob/v8.x/docs/events.md

    const logger = globalThis.logger

    // Logging
    provider.on('access_token.destroyed', (token) => {
        logger.info({}, 'access_token.destroyed')
    })

    provider.on('access_token.saved', (token) => {
        logger.info({}, 'access_token.saved')
    })

    provider.on('access_token.issued', (token) => {
        logger.info({}, 'access_token.issued')
    })

    provider.on('authorization_code.consumed', (code) => {
        logger.info({}, 'authorization_code.consumed')
    })

    provider.on('authorization_code.destroyed', (code) => {
        logger.info({}, 'authorization_code.destroyed')
    })

    provider.on('authorization_code.destroyed', (code) => {
        logger.info({}, 'authorization_code.destroyed')
    })

    provider.on('authorization.accepted', (ctx) => {
        logger.info({ctx}, 'authorization.accepted')
    })

    provider.on('authorization.error', (ctx, error) => {
        logger.info({ctx, error}, 'authorization.error')
    })

    provider.on('authorization.success', (ctx) => {
        logger.info({ctx}, 'authorization.success')
    })

    provider.on('backchannel.error', (ctx, error, client, accountId, sid) => {
        logger.info({ctx, error, client, accountId, sid}, 'backchannel.error')
    })

    provider.on('backchannel.success', (ctx, client, accountId, sid) => {
        logger.info({ctx, client, accountId, sid}, 'backchannel.success')
    })

    provider.on('jwks.error', (ctx, error) => {
        logger.info({ctx, error}, 'jwks.error')
    })

    provider.on('client_credentials.destroyed', (token) => {
        logger.info({}, 'client_credentials.destroyed')
    })

    provider.on('client_credentials.saved', (token) => {
        logger.info({}, 'client_credentials.saved')
    })

    provider.on('client_credentials.issued', (token) => {
        logger.info({}, 'client_credentials.issued')
    })

    provider.on('device_code.consumed', (code) => {
        logger.info({}, 'device_code.consumed')
    })

    provider.on('device_code.destroyed', (code) => {
        logger.info({}, 'device_code.destroyed')
    })

    provider.on('device_code.saved', (code) => {
        logger.info({}, 'device_code.saved')
    })

    provider.on('discovery.error', (ctx, error) => {
        logger.info({ctx, error}, 'discovery.error')
    })

    provider.on('end_session.error', (ctx, error) => {
        logger.info({ctx, error}, 'end_session.error')
    })

    provider.on('end_session.success', (ctx) => {
        logger.info({ctx}, 'end_session.success')
    })

    provider.on('grant.error', (ctx, error) => {
        logger.info({ctx, error}, 'grant.error')
    })

    provider.on('grant.revoked', (ctx, grantId) => {
        logger.info({ctx, grantId}, 'grant.revoked')
    })

    provider.on('grant.success', (ctx) => {
        logger.info({ctx}, 'grant.success')
    })

    provider.on('initial_access_token.destroyed', (token) => {
        logger.info({}, 'initial_access_token.destroyed')
    })

    provider.on('initial_access_token.saved', (token) => {
        logger.info({}, 'initial_access_token.saved')
    })

    provider.on('interaction.destroyed', (interaction) => {
        logger.info({interaction}, 'interaction.destroyed')
    })

    provider.on('interaction.ended', (ctx) => {
        logger.info({ctx}, 'interaction.ended')
    })

    provider.on('interaction.saved', (interaction) => {
        logger.info({interaction}, 'interaction.saved')
    })

    provider.on('interaction.started', (ctx, prompt) => {
        logger.info({ctx, prompt}, 'interaction.started')
    })

    provider.on('introspection.error', (ctx, error) => {
        logger.info({ctx, error}, 'interaction.destroyed')
    })

    provider.on('replay_detection.destroyed', (token) => {
        logger.info({}, 'replay_detection.destroyed')
    })

    provider.on('replay_detection.saved', (token) => {
        logger.info({}, 'replay_detection.saved')
    })

    provider.on('pushed_authorization_request.error', (ctx, error) => {
        logger.info({ctx, error}, 'pushed_authorization_request.error')
    })

    provider.on('pushed_authorization_request.success', (ctx, client) => {
        logger.info({ctx, client}, 'pushed_authorization_request.success')
    })

    provider.on('pushed_authorization_request.destroyed', (token) => {
        logger.info({}, 'pushed_authorization_request.destroyed')
    })

    provider.on('pushed_authorization_request.saved', (token) => {
        logger.info({}, 'pushed_authorization_request.saved')
    })

    provider.on('refresh_token.consumed', (token) => {
        logger.info({}, 'refresh_token.consumed')
    })

    provider.on('refresh_token.destroyed', (token) => {
        logger.info({}, 'refresh_token.destroyed')
    })

    provider.on('refresh_token.saved', (token) => {
        logger.info({}, 'refresh_token.saved')
    })

    provider.on('registration_access_token.destroyed', (token) => {
        logger.info({}, 'registration_access_token.destroyed')
    })

    provider.on('registration_access_token.saved', (token) => {
        logger.info({}, 'registration_access_token.saved')
    })

    provider.on('registration_create.error', (ctx, error) => {
        logger.info({ctx, error}, 'registration_create.error')
    })

    provider.on('registration_create.success', (ctx, client) => {
        logger.info({ctx, client}, 'registration_create.success')
    })

    provider.on('registration_delete.error', (ctx, error) => {
        logger.info({ctx, error}, 'registration_delete.error')
    })

    provider.on('registration_delete.success', (ctx, client) => {
        logger.info({ctx, client}, 'registration_delete.success')
    })

    provider.on('registration_read.error', (ctx, error) => {
        logger.info({ctx, error}, 'registration_read.error')
    })

    provider.on('registration_update.error', (ctx, error) => {
        logger.info({ctx, error}, 'registration_update.error')
    })

    provider.on('registration_update.success', (ctx, client) => {
        logger.info({ctx, client}, 'registration_update.success')
    })

    provider.on('revocation.error', (ctx, error) => {
        logger.info({ctx, error}, 'revocation.error')
    })

    provider.on('server_error', (ctx, error) => {
        logger.info({ctx, error}, 'server_error')
    })

    provider.on('session.destroyed', (session) => {
        logger.info({}, 'session.destroyed')
    })

    provider.on('session.saved', (session) => {
        logger.info({}, 'session.saved')
    })

    provider.on('userinfo.error', (ctx, error) => {
        logger.info({ctx, error}, 'userinfo.error')
    })
}
