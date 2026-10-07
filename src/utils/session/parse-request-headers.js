import {parseUserAgent} from "./user-agent.js";

// The client address as seen by the edge proxy: first hop of x-forwarded-for,
// falling back to the socket address for direct connections.
export const requestIp = (ctx) =>
    ctx.headers?.['x-forwarded-for']?.split(',')[0]?.trim() || ctx.request?.ip || ctx.ip

export const parseRequestMetadata = (metadata, sessionId, currentSession) => {
    const {browser, os} = parseUserAgent(metadata)
    return {
        id: sessionId,
        ip: metadata['x-forwarded-for'],
        browser,
        os,
        current: sessionId ? sessionId === currentSession?.id : undefined,
        created_at: metadata.iat ? new Date(metadata.iat * 1000) : undefined,
        ts: metadata.ts ? new Date(metadata.ts * 1000) : undefined,
    }
}
