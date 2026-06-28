import { test, expect } from '@playwright/test'

// Full browser login through the generic upstream OIDC provider (Dex). Exercises
// the real wire path: openid-client v6 discovery + PKCE + JWKS + userinfo against
// a real IdP, oidc-provider v9, Redis, and real Kubernetes API CRUD (the user is
// created as an OIDCUser custom resource).
test('logs in through the Dex upstream OIDC provider', async ({ page }) => {
    // 1. Unauthenticated dashboard -> passmower login page.
    await page.goto('/')

    // 2. Choose the Dex upstream. Dex's mockCallback connector returns a fixed
    //    identity (kilgore@kilgore.trout / "Kilgore Trout") with no login form.
    await page.getByRole('button', { name: /Sign in with Dex/i }).click()

    // 3. First-time login requires accepting the Terms of Service; a returning
    //    user (e.g. on a retry, since the OIDCUser persists in the cluster)
    //    skips it — so the ToS step is optional.
    try {
        await page.getByRole('button', { name: 'Continue' }).click({ timeout: 15_000 })
    } catch {
        // ToS already accepted on a previous run — continue.
    }

    // 4. Logged in: the profile API returns the upstream identity. This is the
    //    definitive signed-in signal (depends only on the session cookie).
    await expect.poll(
        async () => {
            const res = await page.request.get('/api/me')
            return res.ok() ? await res.text() : ''
        },
        { timeout: 20_000, message: 'waiting for an authenticated /api/me' },
    ).toContain('kilgore@kilgore.trout')
})
