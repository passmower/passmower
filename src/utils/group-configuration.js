// REQUIRED_GROUP and ADMIN_GROUP are matched against group display names, which
// are always "<prefix>:<name>" — a local group carries GROUP_PREFIX, an upstream
// one carries the provider's prefix. A value without a prefix therefore matches
// no group at all: an unprefixed ADMIN_GROUP makes nobody an admin, and an
// unprefixed REQUIRED_GROUP cannot be satisfied by directory membership.
//
// This warns rather than throwing. An install running with a malformed value is
// degraded but serving, and failing at boot on upgrade would turn that into a
// crash loop; since administrators can now approve users whatever
// REQUIRED_GROUP says (#235), a loud warning leaves a working way out.
export function validateGroupConfiguration(env = process.env, logger = globalThis.logger) {
    const problems = []
    for (const name of ['REQUIRED_GROUP', 'ADMIN_GROUP']) {
        const value = env[name]
        if (value && !value.includes(':')) {
            problems.push(`${name}="${value}" has no "<prefix>:<name>" prefix, so it matches no group`)
        }
    }
    for (const problem of problems) {
        logger?.warn({configuration: problem},
            'Group configuration cannot match any group; expected "<prefix>:<name>"')
    }
    return problems
}
