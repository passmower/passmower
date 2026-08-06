import renderError from './render-error.js';

const genericError = {
    error: 'server_error',
    error_description: 'An unexpected error occurred. Please try again later.',
}

export default async function requestErrorHandler(ctx, next) {
    try {
        await next()
    } catch (error) {
        // Once a response is on the wire, let Koa terminate it through its
        // normal error path instead of attempting to append an HTML document.
        if (ctx.headerSent) throw error

        globalThis.logger?.error({
            error,
            method: ctx.method,
            path: ctx.path,
        }, 'Unhandled request error')
        ctx.status = 500
        renderError(ctx, genericError, error)
    }
}
