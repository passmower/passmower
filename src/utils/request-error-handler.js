import renderError from './render-error.js';

const genericError = {
    error: 'server_error',
    error_description: 'An unexpected error occurred. Please try again later.',
}

export default async function requestErrorHandler(ctx, next) {
    try {
        await next()
    } catch (error) {
        // Let Koa preserve intentional client errors, and once a response is
        // on the wire do not attempt to append an HTML document.
        if (ctx.headerSent || (error.status >= 400 && error.status < 500)) throw error

        globalThis.logger?.error({
            error,
            method: ctx.method,
            path: ctx.path,
        }, 'Unhandled request error')
        ctx.status = 500
        renderError(ctx, genericError, error)
    }
}
