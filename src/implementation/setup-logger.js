import pino from "pino";

export const setupLogger = () => {
    globalThis.logger = pino({
        level: process.env.NODE_ENV === 'production' ? 'info' : 'trace',
        redact: [
            'ctx.request.header.cookie',
            'ctx.response.header["set-cookie"].*',
            'interaction.session.cookie',
            '*.jti',
            'interaction.result.token',
            'interaction.result.request.header.cookie',
            'interaction.result.request.url',
            '*.cookie',
            'err.response.headers',
            'err.response.request.headers',
        ]
    })
}
