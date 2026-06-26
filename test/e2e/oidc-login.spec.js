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

    // 3. First login for a new user requires accepting the Terms of Service.
    const tosContinue = page.getByRole('button', { name: 'Continue' })
    await tosContinue.waitFor({ state: 'visible' })
    await tosContinue.click()

    // 4. Land on the authenticated dashboard.
    await expect(page.locator('#app')).toBeVisible()

    // 5. The session is real: the profile API returns the upstream identity.
    const me = await page.request.get('/api/me')
    expect(me.ok()).toBeTruthy()
    const body = await me.json()
    expect(JSON.stringify(body)).toContain('kilgore@kilgore.trout')
})
