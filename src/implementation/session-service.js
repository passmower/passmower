import RedisAdapter from "../adapters/redis.js";
import {UAParser} from "ua-parser-js";
import instance from "oidc-provider/lib/helpers/weak_cache.js";
import revoke from "oidc-provider/lib/helpers/revoke.js";
import nanoid from "oidc-provider/lib/helpers/nanoid.js";
import Account from "../support/account.js";

export class SessionService {
    constructor() {
        this.sessionRedis = new RedisAdapter('Session')
        this.adminSessionRedis = new RedisAdapter('AdminSession')
        this.impersonationRedis = new RedisAdapter('Impersonation')
        this.accountSessionRedis = new RedisAdapter('AccountSession')
        this.metadataRedis = new RedisAdapter('SessionMetadata')
    }

    async getSessions(accountId, currentSession) {
        const sessions = await this.accountSessionRedis.getSetMembers(accountId)
        return await this.mapResponse(sessions, currentSession)
    }

    async endSession(sessionToDelete, currentSession, provider) {
        let sessions = await this.accountSessionRedis.getSetMembers(currentSession.accountId)
        sessionToDelete = sessions.find((s) => {
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
            // TODO: destroy session if logging out from current session.
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

    async getAdminSession(ctx) {
        let adminSession = ctx.cookies.get('_admin_session') // TODO: make configurable?
        if (adminSession) {
            return await this.adminSessionRedis.find(adminSession)
        }
        return null
    }

    async setAdminSession(ctx, session) {
        await this.adminSessionRedis.upsert(session.jti, session, 3600) // TODO: consolidate expirations
        ctx.cookies.set(
            '_admin_session',
            session.jti,
            {
                maxAge: 3600 * 1000,
            },
        );
        return true
    }

    async impersonate(ctx, accountId) {
        let account = Account.findAccount(ctx, accountId)
        if (!accountId) {
            ctx.statusCode = 404
            return
        }
        // Remove the session cookie but keep the session itself intact - admin can later return to it.
        // TODO: would back-channel log-out be required?
        ctx.cookies.set(
            '_session', // TODO: use provider's configuration mechanism
            null,
        );
        ctx.cookies.set(
            '_session.legacy', // TODO: use provider's configuration mechanism
            null,
        );

        const impersonation = {
            jti: nanoid(),
            actor: ctx.adminSession.accountId,
            accountId,
        }
        await this.impersonationRedis.upsert(impersonation.jti, impersonation, 3600) // TODO: consolidate expirations
        ctx.cookies.set(
            '_impersonation',  // TODO: make configurable?
            impersonation.jti,
            {
                // path: url.parse(destination).pathname,
                // ...cookieOptions, // TODO: check if oidc-provider uses some relevant cookieOptions
                maxAge: 3600 * 1000,
            },
        );
        return impersonation
    }

    async getImpersonation(ctx) {
        let impersonation = ctx.cookies.get('_impersonation')
        if (impersonation) {
            impersonation = await this.impersonationRedis.find(impersonation)
        }
        return impersonation
    }

    async endImpersonation(ctx) {
        let impersonation = ctx.cookies.get('_impersonation')
        await this.impersonationRedis.destroy(impersonation)
        ctx.cookies.set(
            '_impersonation',
            null,
        );
        // TODO: restore regular session
    }
}
