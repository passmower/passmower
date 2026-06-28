import { defineConfig } from '@playwright/test'

// End-to-end browser tests. These assume the supporting stack is already up
// (Redis + Dex + a Kubernetes API with the CRDs applied + passmower itself).
// `test/e2e/run-local.sh` brings that stack up for local runs; CI does the
// equivalent in .github/workflows/test.yml.
export default defineConfig({
    testDir: './test/e2e',
    testMatch: '**/*.spec.js',
    timeout: 60_000,
    expect: { timeout: 10_000 },
    fullyParallel: false,
    retries: process.env.CI ? 1 : 0,
    reporter: [['list'], ['html', { open: 'never', outputFolder: 'playwright-report' }]],
    use: {
        baseURL: process.env.PASSMOWER_URL ?? 'http://127.0.0.1:3000',
        ignoreHTTPSErrors: true,
        trace: 'retain-on-failure',
        screenshot: 'only-on-failure',
    },
})
