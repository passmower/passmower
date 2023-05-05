import RedisAdapter from "../adapters/redis.js";
import {UAParser} from "ua-parser-js";
import nanoid from "oidc-provider/lib/helpers/nanoid.js";
import Account from "../support/account.js";
import {confirm as providerEndSession} from "oidc-provider/lib/actions/end_session.js";

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

    async endSession(sessionToDelete, ctx, next, provider) {
        let sessions = await this.accountSessionRedis.getSetMembers(ctx.currentSession.accountId)
        sessionToDelete = sessions.find((s) => {
            return s === sessionToDelete
        })
        if (sessionToDelete !== undefined) {
            await this.endOIDCSession(sessionToDelete, ctx, next, provider)
            await this.metadataRedis.destroy(sessionToDelete)
            await this.accountSessionRedis.removeFromSet(ctx.currentSession.accountId, sessionToDelete)
        }
        sessions = await this.accountSessionRedis.getSetMembers(ctx.currentSession.accountId)
        return await this.mapResponse(sessions, ctx.currentSession)
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

    async endOIDCSession(sessionToDelete, ctx, next, provider) {
        sessionToDelete = await this.sessionRedis.find(sessionToDelete)
        ctx.oidc = {
            // don't clear cookies when it's not current session
            cookies: sessionToDelete?.jti === ctx.currentSession?.jti ? ctx.cookies : {
                set: () => {}
            },
            urlFor: () => {
                // don't redirect when ending other sessions in frontpage
                return ''
            },
            provider,
            session: {
                ...sessionToDelete,
                state: {
                    // do regular full log-out instead of revoking certain client grant
                    clientId: undefined
                },
                authorizationFor: (clientId) => {
                    // copy from oidc-provider/lib/models/session.js
                    // the call will not set, let's not modify the session object
                    if (arguments.length === 1 && !sessionToDelete.authorizations) {
                        return {};
                    }

                    sessionToDelete.authorizations = sessionToDelete.authorizations || {};
                    if (!sessionToDelete.authorizations[clientId]) {
                        sessionToDelete.authorizations[clientId] = {};
                    }

                    return sessionToDelete.authorizations[clientId];
                },
                destroy: async () => {
                    await this.sessionRedis.destroy(sessionToDelete?.jti)
                }
            },
            params: {
                // do regular full log-out instead of revoking certain client grant
                logout: true
            },
        }
        // dirty hack to call out confirm function in oidc-provider/lib/actions/end_session.js
        await providerEndSession['6'](ctx, next)
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
