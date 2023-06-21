import RedisAdapter from "../adapters/redis.js";
import nanoid from "oidc-provider/lib/helpers/nanoid.js";
import Account from "../support/account.js";
import {confirm as providerEndSession} from "oidc-provider/lib/actions/end_session.js";
import instance from "oidc-provider/lib/helpers/weak_cache.js";
import {parseRequestMetadata} from "../support/parse-request-headers.js";

export class SessionService {
    constructor(provider) {
        this.provider = provider
        this.sessionRedis = new RedisAdapter('Session')
        this.adminSessionRedis = new RedisAdapter('AdminSession')
        this.impersonationRedis = new RedisAdapter('Impersonation')
        this.accountSessionRedis = new RedisAdapter('AccountSession')
        this.uidSessionsRedis = new RedisAdapter('UidSessions')
        this.metadataRedis = new RedisAdapter('SessionMetadata')
    }

    async getSessions(accountId, currentSession) {
        const sessions = await this.accountSessionRedis.getSetMembers(accountId)
        return await this.mapResponse(sessions, currentSession)
    }

    async endSession(sessionToDelete, ctx, next) {
        let sessions = await this.accountSessionRedis.getSetMembers(ctx.currentSession.accountId)
        sessionToDelete = sessions.find((s) => {
            return s === sessionToDelete
        })
        if (sessionToDelete !== undefined) {
            await this.endOIDCSession(sessionToDelete, ctx, next)
            // TODO: clean from UidSessions and SessionMetadata
        }
        sessions = await this.accountSessionRedis.getSetMembers(ctx.currentSession.accountId)
        return await this.mapResponse(sessions, ctx.currentSession)
    }

    async mapResponse(sessions, currentSession) {
        sessions = await Promise.all(
            sessions.map(async (s) => {
                let session = await this.sessionRedis.find(s)
                if (session) {
                    const metadatas = await this.uidSessionsRedis.getSetMembers(session.uid)
                    // TODO: sorting
                    if (metadatas && metadatas[0]) {
                        const metadata = await this.metadataRedis.find(metadatas[0])
                        if (metadata) {
                            return parseRequestMetadata(metadata, s, currentSession)
                        }
                    }
                }
            })
        )
        return sessions.filter(item => item);
    }

    async getLastSessionInfoPerClient(accountId, clientId) {
        let accountSessions = await this.accountSessionRedis.getSetMembers(accountId)
        accountSessions = await Promise.all(accountSessions.map(async s => {
            let session = await this.sessionRedis.find(s)
            if (!session) return
            let uidSessions = await this.uidSessionsRedis.getSetMembers(session.uid)
            uidSessions = await Promise.all(uidSessions.map(async s => {
                return await this.metadataRedis.find(s)
            }))
            uidSessions = uidSessions.filter(m => m?.client?.clientId === clientId).sort((a, b) => b.ts - a.ts)
            return uidSessions ? uidSessions[0] : undefined
        }))
        accountSessions = accountSessions.flat().filter(a => a)
        accountSessions = accountSessions.sort((a, b) => b.ts - a.ts)
        return accountSessions[0] ? parseRequestMetadata(accountSessions[0], accountSessions[0].sessionId, undefined)  : undefined
    }

    async endOIDCSession(sessionToDelete, ctx, next) {
        sessionToDelete = await this.sessionRedis.find(sessionToDelete)
        ctx.oidc = {
            // don't clear cookies when it's not current session
            cookies: sessionToDelete?.jti === ctx.currentSession?.jti && ctx.cookies ? ctx.cookies : {
                set: () => {}
            },
            urlFor: () => {
                // don't redirect when ending other sessions in frontpage
                return ''
            },
            provider: this.provider,
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

    async cleanupSessions(accountId) {
        const sessions = await this.accountSessionRedis.getSetMembers(accountId)
        sessions.map(async (s) => {
            const exists = await this.sessionRedis.find(s)
            if (!exists) {
                await this.metadataRedis.destroy(s)
                await this.accountSessionRedis.removeFromSet(accountId, s)
            }
        })
    }

    async getAdminSession(ctx) {
        let adminSession = ctx.cookies.get(this.provider.cookieName('admin_session'))
        if (adminSession) {
            return await this.adminSessionRedis.find(adminSession)
        }
        return null
    }

    async setAdminSession(ctx, session) {
        await this.adminSessionRedis.upsert(session.jti, session, instance(this.provider).configuration('ttl.AdminSession'))
        ctx.cookies.set(
            this.provider.cookieName('admin_session'),
            session.jti,
            {
                ...instance(this.provider).configuration('cookies.long'),
                maxAge: instance(this.provider).configuration('ttl.AdminSession') * 1000,
            },
        );
        return true
    }

    async impersonate(ctx, accountId) {
        let account = await Account.findAccount(ctx, accountId)
        if (!account) {
            ctx.statusCode = 404
            return
        }
        // Remove the session cookie but keep the session itself intact - admin can later return to it.
        // TODO: would back-channel log-out be required?
        ctx.cookies.set(
            this.provider.cookieName('session'),
            null,
        );
        ctx.cookies.set(
            this.provider.cookieName('session') + '.legacy',
            null,
        );

        const impersonation = {
            jti: nanoid(),
            actor: ctx.adminSession.accountId,
            accountId,
        }
        await this.impersonationRedis.upsert(impersonation.jti, impersonation, instance(this.provider).configuration('ttl.Impersonation'))
        ctx.cookies.set(
            this.provider.cookieName('impersonation'),
            impersonation.jti,
            {
                ...instance(this.provider).configuration('cookies.long'),
                maxAge: instance(this.provider).configuration('ttl.Impersonation') * 1000,
            },
        );
        return impersonation
    }

    async getImpersonation(ctx) {
        let impersonation = ctx.cookies.get(this.provider.cookieName('impersonation'))
        if (impersonation) {
            impersonation = await this.impersonationRedis.find(impersonation)
        }
        return impersonation
    }

    async endImpersonation(ctx) {
        let impersonation = ctx.cookies.get(this.provider.cookieName('impersonation'))
        await this.impersonationRedis.destroy(impersonation)
        ctx.cookies.set(
            this.provider.cookieName('impersonation'),
            null,
        );
        ctx.cookies.set(
            this.provider.cookieName('session'),
            ctx.cookies.get(this.provider.cookieName('admin_session')),
            {
                ...instance(this.provider).configuration('cookies.long'),
            }
        );
        ctx.cookies.set(
            this.provider.cookieName('session') + '.legacy',
            ctx.cookies.get(this.provider.cookieName('admin_session')),
            {
                ...instance(this.provider).configuration('cookies.long'),
            }
        );
    }
}
