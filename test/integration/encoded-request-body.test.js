import {describe, it, beforeAll, afterAll} from 'vitest'
import zlib from 'node:zlib'
import request from 'supertest'
import {setupLogger} from '../../src/providers/setup-logger.js'

// CVE-2026-111497: the interaction routes parse bodies before login, so a
// compressed body there reached the Brotli decoder unauthenticated. The real
// provider must refuse it ahead of every router's body parser.
describe('compressed request bodies', () => {
    let agent

    beforeAll(async () => {
        process.env.REDIS_URI ??= 'redis://127.0.0.1:6379'
        setupLogger()
        const {buildProvider} = await import('../../src/app.js')
        agent = request((await buildProvider()).callback())
    })

    afterAll(async () => {
        const {disconnect} = await import('../../src/adapters/redis.js')
        await disconnect()
    })

    it.each([
        '/interaction/does-not-exist/email',
        '/token',
    ])('refuses a br body on %s', async (path) => {
        await agent
            .post(path)
            .set('content-type', 'application/x-www-form-urlencoded')
            .set('content-encoding', 'br')
            .send(zlib.brotliCompressSync('email=someone%40example.com'))
            .expect(415)
    })
})
