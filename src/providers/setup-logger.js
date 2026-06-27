import pino from "pino";

export const setupLogger = () => {
    globalThis.logger = pino({
        level: process.env.NODE_ENV === 'production' ? 'info' : 'trace',
        redact: [
            'ctx.request.header.cookie',
            // NOTE: do NOT redact 'ctx.response.header["set-cookie"]'. Koa's
            // ctx.response.header is a getter returning a fresh object each
            // access, which breaks pino/fast-redact's mutate-then-restore for
            // array-wildcard paths: it mutates the *live* Set-Cookie array in
            // place but restores into a throwaway copy, leaving "[Redacted]" on
            // the actual response and corrupting every cookie (breaks login).
            'interaction.session.cookie',
            '*.jti',
            'interaction.result.token',
            'interaction.result.request.header.cookie',
            'interaction.result.request.url',
            '*.cookie',
            'result.oauth.token',
            'err.response.headers',
            'err.response.request.headers',
            'err.stack',
        ]
    })
}
