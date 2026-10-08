import instance from "oidc-provider/lib/helpers/weak_cache.js";

// Logging out of Passmower leaves the upstream (GitHub, an OIDC provider)
// signed in, so choosing it again would silently bring back the same account.
// A logout from a sign-in page is remembered for the next upstream sign-in,
// which then asks the upstream to show its account picker.
const COOKIE = '_select_account'
const MAX_AGE_MS = 15 * 60 * 1000

const options = (provider) => ({
    ...instance(provider).configuration.cookies.short,
    path: '/',
    signed: true,
})

export const rememberLogout = (ctx, provider) => {
    ctx.cookies.set(COOKIE, '1', {...options(provider), maxAge: MAX_AGE_MS})
}

// Whether the user logged out since their last upstream sign-in started;
// answering also forgets it, so only the next sign-in shows the picker.
export const takeSelectAccount = (ctx, provider) => {
    if (ctx.cookies.get(COOKIE, {signed: true}) !== '1') return false
    ctx.cookies.set(COOKIE, null, options(provider))
    return true
}
