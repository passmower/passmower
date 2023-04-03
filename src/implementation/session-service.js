import RedisAdapter from "../adapters/redis.js";
import {UAParser} from "ua-parser-js";
import instance from "oidc-provider/lib/helpers/weak_cache.js";
import revoke from "oidc-provider/lib/helpers/revoke.js";

export class SessionService {
    constructor() {
        this.sessionRedis = new RedisAdapter('Session')
        this.accountSessionRedis = new RedisAdapter('AccountSession')
        this.metadataRedis = new RedisAdapter('SessionMetadata')
    }

    async getSessions(accountId, currentSession) {
        const sessions = await this.accountSessionRedis.getSetMembers(accountId)
        return await this.mapResponse(sessions, currentSession)
    }

    async endSession(sessionToDelete, currentSession, provider) {
        let sessions = await this.accountSessionRedis.getSetMembers(currentSession.accountId)
        sessionToDelete = sessions.filter((s) => {return s !== currentSession.jti}).find((s) => {
            return s === sessionToDelete
        })
        if (sessionToDelete !== undefined) {
            await this.metadataRedis.destroy(sessionToDelete)
            await this.accountSessionRedis.removeFromSet(currentSession.accountId, sessionToDelete)
            const session = this.sessionRedis.find(sessionToDelete)
            await this.sessionRedis.destroy(sessionToDelete)
            await this.endOIDCSession(session, provider)
        }
        sessions = await this.accountSessionRedis.getSetMembers(currentSession.accountId)
        return await this.mapResponse(sessions, currentSession)
    }

    async mapResponse(sessions, currentSession) {
        sessions = await Promise.all(
            sessions.map(async (s) => {
                const metadata = await this.metadataRedis.find(s)
                if (metadata !== undefined) {
                    const ua = UAParser(metadata).withClientHints()
                    return {
                        id: s,
                        ua,
                        ip: metadata['x-forwarded-for'],
                        browser: ua.browser.name,
                        os: ua.os.name + (ua.os.version !== undefined ? (' ' + ua.os.version) : ''),
                        current: s === currentSession.id,
                        created_at: new Date(metadata.iat * 1000),
                    }
                }
            })
        )
        return sessions.filter(item => item);
    }

    async endOIDCSession(session, provider) {
        // This is a modified version of oidc-provider/lib/actions/end_session.js
        // It will execute some relevant logic, but redirection, removal of current session cookie and so on are commented out.

        // const { oidc: { session } } = ctx;
        // const { state } = session;

        const state = {
            clientId: undefined
        }

        const params = {
            logout: true
        };

        const ctx = {
            oidc: {
                provider
            }
        }

        const {
            features: { backchannelLogout },
            cookies: { long: opts },
        } = instance(ctx.oidc.provider).configuration();

        if (backchannelLogout.enabled) {
            const clientIds = Object.keys(session.authorizations || {});

            const back = [];

            for (const clientId of clientIds) {
                if (params.logout || clientId === state.clientId) {
                    const client = await ctx.oidc.provider.Client.find(clientId); // eslint-disable-line no-await-in-loop
                    if (client) {
                        const sid = session.sidFor(client.clientId);
                        if (client.backchannelLogoutUri) {
                            const { accountId } = session;
                            back.push(client.backchannelLogout(accountId, sid)
                                .then(() => {
                                    ctx.oidc.provider.emit('backchannel.success', ctx, client, accountId, sid);
                                }, (err) => {
                                    ctx.oidc.provider.emit('backchannel.error', ctx, err, client, accountId, sid);
                                }));
                        }
                    }
                }
            }

            await Promise.all(back);
        }

        if (state.clientId) {
            ctx.oidc.entity('Client', await ctx.oidc.provider.Client.find(state.clientId));
        }

        if (params.logout) {
            if (session.authorizations) {
                await Promise.all(
                    Object.entries(session.authorizations).map(async ([clientId, { grantId }]) => {
                        // Drop the grants without offline_access
                        // Note: tokens that don't get dropped due to offline_access having being added
                        // later will still not work, as such they will be orphaned until their TTL hits
                        if (grantId && !session.authorizationFor(clientId).persistsLogout) {
                            await revoke(ctx, grantId);
                        }
                    }),
                );
            }

            // await session.destroy();

            // Do not destroy current session.
            // ssHandler.set(
            //     ctx.oidc.cookies,
            //     ctx.oidc.provider.cookieName('session'),
            //     null,
            //     opts,
            // );
        } else if (state.clientId) {
            const grantId = session.grantIdFor(state.clientId);
            if (grantId && !session.authorizationFor(state.clientId).persistsLogout) {
                await revoke(ctx, grantId);
                ctx.oidc.provider.emit('grant.revoked', ctx, grantId);
            }
            session.state = undefined;
            if (session.authorizations) {
                delete session.authorizations[state.clientId];
            }
            session.resetIdentifier();
        }

        // const usePostLogoutUri = state.postLogoutRedirectUri;
        // const forwardClientId = !usePostLogoutUri && !params.logout && state.clientId;
        // const uri = redirectUri(
        //     usePostLogoutUri ? state.postLogoutRedirectUri : ctx.oidc.urlFor('end_session_success'),
        //     {
        //         ...(usePostLogoutUri && state.state != null
        //             ? { state: state.state } : undefined), // != intended
        //         ...(forwardClientId ? { client_id: state.clientId } : undefined),
        //     },
        // );

        ctx.oidc.provider.emit('end_session.success', ctx);

        // ctx.status = 303;
        // ctx.redirect(uri);
        //
        // await next();
    }
}