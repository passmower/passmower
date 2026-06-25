// How a new user's username (the OIDCUser metadata.name / accountId, which is
// also the OIDC `sub`) is determined at enrollment:
//   - 'generated' : a random `u<id>` (Account.getUid)
//   - 'prompt'    : the user picks one via the enter-username form
//   - 'upstream'  : derived from the upstream provider's username (GitHub login,
//                   OIDC preferred_username); falls back to 'prompt' on conflict
export const USERNAME_SOURCES = ['generated', 'prompt', 'upstream']

let resolved

// Resolves USERNAME_SOURCE once. When unset, maps the deprecated
// USE_GITHUB_USERNAME / REQUIRE_CUSTOM_USERNAME flags and warns. Resolved lazily
// so globalThis.logger (set up at boot) is available for the deprecation warning.
export function getUsernameSource() {
    if (resolved) {
        return resolved
    }

    const explicit = process.env.USERNAME_SOURCE
    if (explicit) {
        if (!USERNAME_SOURCES.includes(explicit)) {
            throw new Error(`Invalid USERNAME_SOURCE "${explicit}". Must be one of: ${USERNAME_SOURCES.join(', ')}`)
        }
        resolved = explicit
        return resolved
    }

    const useGithub = process.env.USE_GITHUB_USERNAME === 'true'
    const requireCustom = process.env.REQUIRE_CUSTOM_USERNAME === 'true'
    if (useGithub || requireCustom) {
        // Both set was the historical conflict; the validated prompt path wins.
        resolved = (requireCustom || !useGithub) ? 'prompt' : 'upstream'
        globalThis.logger?.warn(
            `USE_GITHUB_USERNAME/REQUIRE_CUSTOM_USERNAME are deprecated; resolved to USERNAME_SOURCE=${resolved}. Set USERNAME_SOURCE explicitly.`
        )
        return resolved
    }

    resolved = 'generated'
    return resolved
}
