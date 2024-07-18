import {updateSessionReference} from "../utils/session/site-session.js";
import {SessionService} from "../services/session-service.js";
import handleOidcFlowMetrics, {
    clientNotFound, invalidClientError,
    nonExistentClientError, tokenError,
    userinfoError
} from "../utils/session/handle-oidc-flow-metrics.js";

export default (provider) => {
    // https://github.com/panva/node-oidc-provider/blob/v8.x/docs/events.md

    const logger = globalThis.logger

    // Logging
    provider.on('access_token.destroyed', (token) => {
        logger.debug({}, 'access_token.destroyed')
    })

    provider.on('access_token.saved', (token) => {
        logger.debug({}, 'access_token.saved')
    })

    provider.on('access_token.issued', (token) => {
        logger.debug({}, 'access_token.issued')
    })

    provider.on('authorization_code.consumed', (code) => {
        logger.info({code}, 'Client consumed authorization code')
    })

    provider.on('authorization_code.destroyed', (code) => {
        logger.debug({}, 'authorization_code.destroyed')
    })

    provider.on('authorization_code.destroyed', (code) => {
        logger.debug({}, 'authorization_code.destroyed')
    })

    provider.on('authorization.accepted', (ctx) => {
        logger.debug({ctx}, 'authorization.accepted')
    })

    provider.on('authorization.error', (ctx, error) => {
        logger.error({ctx, error}, 'authorization.error')
        handleOidcFlowMetrics(ctx, error, error.error_detail === clientNotFound ? nonExistentClientError : invalidClientError)
    })

    provider.on('authorization.success', (ctx) => {
        logger.debug({ctx}, 'authorization.success')
    })

    provider.on('backchannel.error', (ctx, error, client, accountId, sid) => {
        logger.error({ctx, error, client, accountId, sid}, 'backchannel.error')
    })

    provider.on('backchannel.success', (ctx, client, accountId, sid) => {
        logger.debug({ctx, client, accountId, sid}, 'backchannel.success')
    })

    provider.on('jwks.error', (ctx, error) => {
        logger.error({ctx, error}, 'jwks.error')
    })

    provider.on('client_credentials.destroyed', (token) => {
        logger.debug({}, 'client_credentials.destroyed')
    })

    provider.on('client_credentials.saved', (token) => {
        logger.debug({}, 'client_credentials.saved')
    })

    provider.on('client_credentials.issued', (token) => {
        logger.debug({}, 'client_credentials.issued')
    })

    provider.on('device_code.consumed', (code) => {
        logger.debug({}, 'device_code.consumed')
    })

    provider.on('device_code.destroyed', (code) => {
        logger.debug({}, 'device_code.destroyed')
    })

    provider.on('device_code.saved', (code) => {
        logger.debug({}, 'device_code.saved')
    })

    provider.on('discovery.error', (ctx, error) => {
        logger.error({ctx, error}, 'discovery.error')
    })

    provider.on('end_session.error', (ctx, error) => {
        logger.error({ctx, error}, 'end_session.error')
    })

    provider.on('end_session.success', (ctx) => {
        logger.debug({ctx}, 'end_session.success')
    })

    provider.on('grant.error', (ctx, error) => {
        logger.error({ctx, error}, 'grant.error')
        handleOidcFlowMetrics(ctx, error, tokenError)
    })

    provider.on('grant.revoked', (ctx, grantId) => {
        logger.debug({ctx, grantId}, 'grant.revoked')
    })

    provider.on('grant.success', (ctx) => {
        logger.debug({ctx}, 'grant.success')
    })

    provider.on('initial_access_token.destroyed', (token) => {
        logger.debug({}, 'initial_access_token.destroyed')
    })

    provider.on('initial_access_token.saved', (token) => {
        logger.debug({}, 'initial_access_token.saved')
    })

    provider.on('interaction.destroyed', (interaction) => {
        logger.debug({interaction}, 'interaction.destroyed')
    })

    provider.on('interaction.ended', (ctx) => {
        logger.debug({ctx}, 'interaction.ended')
    })

    provider.on('interaction.saved', (interaction) => {
        logger.debug({interaction}, 'interaction.saved')
    })

    provider.on('interaction.started', (ctx, prompt) => {
        logger.debug({ctx, prompt}, 'interaction.started')
    })

    provider.on('introspection.error', (ctx, error) => {
        logger.error({ctx, error}, 'interaction.destroyed')
    })

    provider.on('replay_detection.destroyed', (token) => {
        logger.debug({}, 'replay_detection.destroyed')
    })

    provider.on('replay_detection.saved', (token) => {
        logger.debug({}, 'replay_detection.saved')
    })

    provider.on('pushed_authorization_request.error', (ctx, error) => {
        logger.error({ctx, error}, 'pushed_authorization_request.error')
    })

    provider.on('pushed_authorization_request.success', (ctx, client) => {
        logger.debug({ctx, client}, 'pushed_authorization_request.success')
    })

    provider.on('pushed_authorization_request.destroyed', (token) => {
        logger.debug({}, 'pushed_authorization_request.destroyed')
    })

    provider.on('pushed_authorization_request.saved', (token) => {
        logger.debug({}, 'pushed_authorization_request.saved')
    })

    provider.on('refresh_token.consumed', (token) => {
        logger.info({token}, 'Client consumed refresh token')
    })

    provider.on('refresh_token.destroyed', (token) => {
        logger.debug({}, 'refresh_token.destroyed')
    })

    provider.on('refresh_token.saved', (token) => {
        logger.debug({}, 'refresh_token.saved')
    })

    provider.on('registration_access_token.destroyed', (token) => {
        logger.debug({}, 'registration_access_token.destroyed')
    })

    provider.on('registration_access_token.saved', (token) => {
        logger.debug({}, 'registration_access_token.saved')
    })

    provider.on('registration_create.error', (ctx, error) => {
        logger.error({ctx, error}, 'registration_create.error')
    })

    provider.on('registration_create.success', (ctx, client) => {
        logger.debug({ctx, client}, 'registration_create.success')
    })

    provider.on('registration_delete.error', (ctx, error) => {
        logger.error({ctx, error}, 'registration_delete.error')
    })

    provider.on('registration_delete.success', (ctx, client) => {
        logger.debug({ctx, client}, 'registration_delete.success')
    })

    provider.on('registration_read.error', (ctx, error) => {
        logger.error({ctx, error}, 'registration_read.error')
    })

    provider.on('registration_update.error', (ctx, error) => {
        logger.error({ctx, error}, 'registration_update.error')
    })

    provider.on('registration_update.success', (ctx, client) => {
        logger.debug({ctx, client}, 'registration_update.success')
    })

    provider.on('revocation.error', (ctx, error) => {
        logger.error({ctx, error}, 'revocation.error')
    })

    provider.on('server_error', (ctx, error) => {
        logger.error({ctx, error}, 'server_error')
    })

    provider.on('session.destroyed', async (session) => {
        logger.debug({}, 'session.destroyed')
        if (session.accountId) {
            const sessionService = new SessionService(provider)
            await sessionService.cleanupSessions(session.accountId)
        }
    })

    provider.on('session.saved', async (session) => {
        logger.debug({session}, 'session.saved')
        if (session.oldId && session.accountId) {
            await updateSessionReference(session.jti, session.oldId, session.accountId)
        }
    })

    provider.on('userinfo.error', (ctx, error) => {
        logger.error({ctx, error}, 'userinfo.error')
        handleOidcFlowMetrics(ctx, error, userinfoError)
    })
}
