import Router from "koa-router";

export default (provider) => {
    const router = new Router();

    router.get('/admin', async (ctx, next) => {
        return ctx.render('adminpage', { layout: false, title: 'oidc-gateway' })
    })

    return router
}
