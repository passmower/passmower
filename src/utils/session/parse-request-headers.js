import {UAParser} from "ua-parser-js";

// The client address as seen by the edge proxy: first hop of x-forwarded-for,
// falling back to the socket address for direct connections.
export const requestIp = (ctx) =>
    ctx.headers?.['x-forwarded-for']?.split(',')[0]?.trim() || ctx.request?.ip || ctx.ip

export const parseRequestMetadata = (metadata, sessionId, currentSession) => {
    const ua = UAParser(metadata).withClientHints()
    return {
        id: sessionId,
        ua,
        ip: metadata['x-forwarded-for'],
        browser: ua.browser.name,
        os: ua.os.name + (ua.os.version !== undefined ? (' ' + ua.os.version) : ''),
        current: sessionId ? sessionId === currentSession?.id : undefined,
        created_at: metadata.iat ? new Date(metadata.iat * 1000) : undefined,
        ts: metadata.ts ? new Date(metadata.ts * 1000) : undefined,
    }
}
