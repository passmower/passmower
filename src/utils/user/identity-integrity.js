import validator from 'validator';

export class IdentityIntegrityError extends Error {
    constructor(message, details = {}) {
        super(message)
        this.name = 'IdentityIntegrityError'
        this.details = details
    }
}

export function canonicalizeEmail(email, env = process.env) {
    if (typeof email !== 'string') return undefined
    const trimmed = email.trim().toLowerCase()
    if (!trimmed) return undefined
    if (env.NORMALIZE_EMAIL_ADDRESSES === 'true') {
        return validator.normalizeEmail(trimmed) || undefined
    }
    return trimmed
}

function accountOrder(a, b) {
    const aCreated = Date.parse(a.getMetadata()?.creationTimestamp ?? '')
    const bCreated = Date.parse(b.getMetadata()?.creationTimestamp ?? '')
    const byCreation = (Number.isFinite(aCreated) ? aCreated : Number.MAX_SAFE_INTEGER)
        - (Number.isFinite(bCreated) ? bCreated : Number.MAX_SAFE_INTEGER)
    return byCreation || a.accountId.localeCompare(b.accountId)
}

export function assessEmailOwnership(accounts) {
    const ordered = [...accounts].sort(accountOrder)
    const claims = new Map()
    for (const account of ordered) {
        for (const email of account.getClaimedEmails()) {
            const claimants = claims.get(email) ?? []
            claimants.push(account)
            claims.set(email, claimants)
        }
    }
    const owners = new Map()
    const conflicts = new Map()
    for (const [email, claimants] of claims) {
        const owner = claimants[0]
        owners.set(email, owner)
        for (const duplicate of claimants.slice(1)) {
            const entries = conflicts.get(duplicate.accountId) ?? []
            entries.push({email, ownerAccountId: owner.accountId})
            conflicts.set(duplicate.accountId, entries)
        }
    }
    return {
        owners,
        conflicts,
        isEligible: account => !conflicts.has(account.accountId),
    }
}
