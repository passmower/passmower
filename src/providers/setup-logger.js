import pino from "pino";

const headerSnapshot = (header) => header && typeof header === 'object' ? {...header} : header

// pino 10's @pinojs/redact selectively clones the log object before censoring,
// but Koa exposes request/response `header` through prototype getters, which
// the clone walk (hasOwnProperty) skips while the censor walk (`in`) follows.
// Redacting `ctx.request.header.cookie` therefore wrote "[Redacted]" straight
// into the live req.headers, destroying every cookie for the remainder of the
// request (site-session validation looped forever). Serializers run before
// redaction, so snapshotting ctx into plain owned objects keeps the censor away
// from live request state. Never log a raw Koa ctx under any other key.
export const serializeCtx = (ctx) => {
    if (!ctx || typeof ctx !== 'object') return ctx
    if (!ctx.request && !ctx.response) return ctx
    return {
        request: ctx.request ? {
            method: ctx.request.method,
            url: ctx.request.url,
            header: headerSnapshot(ctx.request.header),
        } : undefined,
        response: ctx.response ? {
            status: ctx.response.status,
            message: ctx.response.message,
            header: headerSnapshot(ctx.response.header),
        } : undefined,
        originalUrl: ctx.originalUrl,
        app: {issuer: process.env.ISSUER_URL},
    }
}

export const loggerOptions = () => ({
    level: process.env.NODE_ENV === 'production' ? 'info' : 'trace',
    serializers: {
        ctx: serializeCtx,
    },
    redact: [
        'ctx.request.header.cookie',
        // NOTE: do NOT redact 'ctx.response.header["set-cookie"]'. Koa's
        // ctx.response.header is a getter returning a fresh object each
        // access, which breaks pino/fast-redact's mutate-then-restore for
        // array-wildcard paths: it mutates the *live* Set-Cookie array in
        // place but restores into a throwaway copy, leaving "[Redacted]" on
        // the actual response and corrupting every cookie (breaks login).
        // The ctx serializer above snapshots headers, so redaction below only
        // ever touches plain copies.
        'interaction.session.cookie',
        '*.jti',
        'interaction.result.token',
        'interaction.result.oauth.token',
        'interaction.result.request.header.cookie',
        'interaction.result.request.url',
        '*.cookie',
        'result.oauth.token',
        'err.response.headers',
        'err.response.request.headers',
        'err.stack',
    ],
})

export const setupLogger = () => {
    globalThis.logger = pino(loggerOptions())
}
