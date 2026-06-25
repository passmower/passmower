import validatorLib from "validator";
import usernameBlacklist from "./username-blacklist.js";
import Account from "../../models/account.js";

// The canonical username rules, shared by the enter-username form validation
// (see validator.js checkUsername) and the `upstream` enrollment path so the two
// cannot drift. Each rule's `message` matches what the form surfaces to the user.
export const USERNAME_RULES = [
    { test: (v) => validatorLib.isLength(String(v || ''), { min: 3, max: 15 }), message: 'Username must be 3-15 characters' },
    { test: (v) => validatorLib.isAlphanumeric(String(v || '')), message: 'Username must be alphanumeric' },
    { test: (v) => usernameBlacklist(v), message: 'Prohibited username' },
    { test: (v) => (/^[a-z]/).test(String(v || '')), message: 'Username must start with a letter' },
    { test: (v) => validatorLib.isLowercase(String(v || '')), message: 'Username must be lowercase' },
]

// Programmatic validity check (format/blacklist), used by the `upstream` path.
export function isUsernameValid(value) {
    if (!value) {
        return false
    }
    return USERNAME_RULES.every((rule) => rule.test(value))
}

// Uniqueness check — same source of truth as the form's `usernameExists`.
export async function isUsernameAvailable(ctx, value) {
    if (!value) {
        return false
    }
    const user = await Account.findAccount(ctx, value)
    return !user
}

// Best-effort coercion of an upstream username (GitHub login, OIDC
// preferred_username — which may be an email) into something matching the rules.
// Returns null when nothing usable remains; callers should then fall back to the
// prompt form. The result still has to pass isUsernameValid / isUsernameAvailable.
export function sanitizeUsername(raw) {
    if (!raw) {
        return null
    }
    const sanitized = String(raw)
        .toLowerCase()
        .split('@')[0]            // OIDC preferred_username may be an email
        .replace(/[^a-z0-9]/g, '') // rules require alphanumeric
        .replace(/^[0-9]+/, '')    // must start with a letter
        .slice(0, 15)              // length cap
    return sanitized || null
}
