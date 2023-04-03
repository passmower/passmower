import RedisAdapter from "../adapters/redis.js";
import {UAParser} from "ua-parser-js";

export class SessionService {
    constructor() {
        this.sessionRedis = new RedisAdapter('Sessions')
        this.accountSessionRedis = new RedisAdapter('AccountSession')
        this.metadataRedis = new RedisAdapter('SessionMetadata')
    }

    async getSessions(accountId, currentSession) {
        const sessions = await this.accountSessionRedis.getSetMembers(accountId)
        return await this.mapResponse(sessions, currentSession)
    }

    async endSession(sessionToDelete, currentSession) {
        let sessions = await this.accountSessionRedis.getSetMembers(currentSession.accountId)
        sessionToDelete = sessions.filter((s) => {return s === currentSession.jti}).find((s) => {
            return s === sessionToDelete
        })
        if (sessionToDelete !== undefined) {
            await this.sessionRedis.destroy(sessionToDelete)
            await this.accountSessionRedis.removeFromSet(currentSession.accountId, sessionToDelete)
            sessions = sessions.filter((s) => {return s === sessionToDelete})
            // TODO: back channel logout etc.
        }
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
}