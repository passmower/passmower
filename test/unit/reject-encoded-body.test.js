import {describe, expect, it, vi} from 'vitest'
import zlib from 'node:zlib'
import Koa from 'koa'
import {koaBody} from 'koa-body'
import request from 'supertest'
import rejectEncodedBody from '../../src/utils/reject-encoded-body.js'

// koa-body decompresses request bodies it is handed; CVE-2026-111497 made a
// crafted br body an unauthenticated RCE. The guard must stop compressed
// bodies before any parser sees them.
const app = (onBody) => {
    const koa = new Koa()
    koa.use(rejectEncodedBody)
    koa.use(koaBody({json: true}))
    koa.use((ctx) => {
        onBody(ctx.request.body)
        ctx.body = {ok: true}
    })
    return koa.callback()
}

const json = JSON.stringify({hello: 'world'})

describe('rejectEncodedBody', () => {
    it.each([
        ['br', zlib.brotliCompressSync(json)],
        ['gzip', zlib.gzipSync(json)],
        ['deflate', zlib.deflateSync(json)],
        ['BR', zlib.brotliCompressSync(json)],
    ])('refuses a %s request body without parsing it', async (encoding, body) => {
        const onBody = vi.fn()
        const res = await request(app(onBody))
            .post('/')
            .set('content-type', 'application/json')
            .set('content-encoding', encoding)
            .send(body)
            .expect(415)

        expect(res.body.error).toBe('invalid_request')
        expect(res.headers['accept-encoding']).toBe('identity')
        expect(onBody).not.toHaveBeenCalled()
    })

    it('refuses an encoding it does not recognise', async () => {
        const onBody = vi.fn()
        await request(app(onBody))
            .post('/')
            .set('content-type', 'application/json')
            .set('content-encoding', 'zstd')
            .send(json)
            .expect(415)
        expect(onBody).not.toHaveBeenCalled()
    })

    it.each([
        ['no', undefined],
        ['an identity', 'identity'],
    ])('passes a body with %s content-encoding through to the parser', async (_, encoding) => {
        const onBody = vi.fn()
        const req = request(app(onBody)).post('/').set('content-type', 'application/json')
        if (encoding) req.set('content-encoding', encoding)
        await req.send(json).expect(200)
        expect(onBody).toHaveBeenCalledWith({hello: 'world'})
    })
})
