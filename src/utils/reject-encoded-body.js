// koa-body (via co-body and inflation) decompresses gzip, deflate and br
// request bodies before any route or auth check runs, and offers no option to
// turn that off. No browser or client Passmower serves compresses request
// bodies, so refuse them outright: the decompressor is then never handed
// attacker-controlled input (CVE-2026-111497 was a Brotli decoder RCE reachable
// exactly this way).
export default async function rejectEncodedBody(ctx, next) {
    const encoding = ctx.get('content-encoding').trim().toLowerCase()
    if (encoding && encoding !== 'identity') {
        ctx.status = 415
        ctx.set('Accept-Encoding', 'identity')
        ctx.body = {
            error: 'invalid_request',
            error_description: 'Compressed request bodies are not supported',
        }
        return
    }
    return next()
}
