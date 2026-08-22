import {describe, expect, it} from 'vitest'
import pino from 'pino'
import {Writable} from 'node:stream'
import {loggerOptions, serializeCtx} from '../../src/providers/setup-logger.js'

// Koa exposes request.header through a prototype getter. @pinojs/redact's
// selective clone skips prototype getters (hasOwnProperty) while its censor
// walk follows them (`in`), so redacting through a live Koa ctx mutates the
// real req.headers. These tests pin the serializer that keeps redaction away
// from live request state.
class KoaLikeRequest {
    constructor(req) {
        this.req = req
    }
    get header() {
        return this.req.headers
    }
    get method() {
        return this.req.method
    }
    get url() {
        return this.req.url
    }
}

const liveCookie = '_site_session.passmower=abc; _session=xyz'

const makeCtx = () => {
    const req = {method: 'GET', url: '/auth/x', headers: {cookie: liveCookie, host: 'x'}}
    return {request: new KoaLikeRequest(req), originalUrl: '/auth/x', req}
}

describe('logger redaction safety', () => {
    it('redacts the logged cookie without mutating the live request headers', () => {
        const lines = []
        const sink = new Writable({write(chunk, encoding, callback) {
            lines.push(chunk.toString())
            callback()
        }})
        const logger = pino(loggerOptions(), sink)
        const ctx = makeCtx()

        logger.error({ctx}, 'authorization.error')
        logger.debug({ctx}, 'interaction.started')

        expect(ctx.req.headers.cookie).toBe(liveCookie)
        const out = lines.join('')
        expect(out).toContain('"cookie":"[Redacted]"')
        expect(out).not.toContain('_site_session.passmower=abc')
    })

    it('snapshots headers into plain owned objects', () => {
        const ctx = makeCtx()
        const snapshot = serializeCtx(ctx)
        expect(snapshot.request.header).not.toBe(ctx.req.headers)
        expect(snapshot.request.header.cookie).toBe(liveCookie)
        expect(snapshot.request.method).toBe('GET')
        // non-koa values pass through untouched
        expect(serializeCtx(undefined)).toBeUndefined()
        expect(serializeCtx({foo: 1})).toEqual({foo: 1})
    })
})
