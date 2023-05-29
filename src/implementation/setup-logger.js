import pino from "pino";

export const setupLogger = () => {
    globalThis.logger = pino({
        redact: [
            'ctx.request.header.cookie',
            'ctx.response.header["set-cookie"].*',
            'interaction.session.cookie',
            '*.jti',
            'interaction.result.token',
            'interaction.result.request.header.cookie',
            'interaction.result.request.url',
        ]
    })
}
