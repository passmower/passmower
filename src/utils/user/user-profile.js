import {getListedPrivilegeGroups} from "./privilege-directory.js";

// User profile pages (#318): /users/<username> shows who a subject is, so
// applications can make the `sub` they display a link. Administrators can
// always open them; USER_PROFILES_ENABLED opens them to every signed-in user.
export const userProfilesEnabled = (env = process.env) => env.USER_PROFILES_ENABLED === 'true'

export const canViewUserProfiles = (viewer, env = process.env) =>
    Boolean(viewer?.isAdmin) || userProfilesEnabled(env)

export const userProfilePath = (username) => `/users/${encodeURIComponent(username)}`

// The OIDC `profile` claim: the URL of the End-User's profile page.
export const userProfileUrl = (username, env = process.env) =>
    `${env.ISSUER_URL}${userProfilePath(username).slice(1)}`

const SHOWN_TYPES = new Map([[null, 'person'], [undefined, 'person'], ['person', 'person'], ['service', 'service']])

// What one signed-in user may see of another: the same refined projection the
// privilege directory publishes, plus company. Group memberships are limited
// to the groups that directory already lists; everything else about the
// account (other groups, identities, conditions, activity, phone numbers)
// stays out. Reserved names (banned, org, group accounts) have no profile.
export const buildUserProfile = (account, {slackTeamId, listedGroups = getListedPrivilegeGroups()} = {}) => {
    const type = SHOWN_TYPES.get(account?.type)
    if (!account || !type) return undefined
    const memberships = account.groups.map(group => `${group.prefix}:${group.name}`)
    return {
        username: account.accountId,
        type,
        name: account.profile?.name,
        company: account.profile?.company,
        email: account.primaryEmail,
        slackUrl: slackTeamId && account.slackId
            ? `slack://user?team=${encodeURIComponent(slackTeamId)}&id=${encodeURIComponent(account.slackId)}`
            : undefined,
        roles: listedGroups.filter(group => memberships.includes(group)),
    }
}
