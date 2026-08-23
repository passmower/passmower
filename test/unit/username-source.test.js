import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// getUsernameSource memoises its result in module scope, so each case re-imports
// the module fresh under a stubbed environment.
async function resolveWith(env) {
    vi.resetModules()
    for (const [k, v] of Object.entries(env)) vi.stubEnv(k, v)
    const mod = await import('../../src/utils/username-source.js')
    return mod.getUsernameSource()
}

beforeEach(() => {
    // Clear the deprecated/explicit vars that env.js or other cases may have set.
    vi.stubEnv('USERNAME_SOURCE', '')
    vi.stubEnv('USE_GITHUB_USERNAME', '')
    vi.stubEnv('REQUIRE_CUSTOM_USERNAME', '')
})
afterEach(() => vi.unstubAllEnvs())

describe('getUsernameSource', () => {
    it('defaults to "generated" when nothing is set', async () => {
        expect(await resolveWith({})).toBe('generated')
    })

    it('honours an explicit USERNAME_SOURCE', async () => {
        expect(await resolveWith({ USERNAME_SOURCE: 'upstream' })).toBe('upstream')
        expect(await resolveWith({ USERNAME_SOURCE: 'prompt' })).toBe('prompt')
    })

    it('throws on an invalid USERNAME_SOURCE', async () => {
        await expect(resolveWith({ USERNAME_SOURCE: 'bogus' })).rejects.toThrow(/Invalid USERNAME_SOURCE/)
    })

    it('maps the deprecated USE_GITHUB_USERNAME flag to "upstream"', async () => {
        expect(await resolveWith({ USE_GITHUB_USERNAME: 'true' })).toBe('upstream')
    })

    it('maps REQUIRE_CUSTOM_USERNAME (which wins over USE_GITHUB_USERNAME) to "prompt"', async () => {
        expect(await resolveWith({ REQUIRE_CUSTOM_USERNAME: 'true' })).toBe('prompt')
        expect(await resolveWith({ REQUIRE_CUSTOM_USERNAME: 'true', USE_GITHUB_USERNAME: 'true' })).toBe('prompt')
    })
})
