import RedisAdapter from "../../adapters/redis.js";

const INDEX = 'index'
const DEFAULT_TTL_SECONDS = 7 * 24 * 3600
const LIST_LIMIT = 100

export const incidentsEnabled = (env = process.env) => env.INCIDENTS_ENABLED !== 'false'

export const incidentTtlSeconds = (env = process.env) => {
    const value = Number.parseInt(env.INCIDENT_TTL_SECONDS ?? '', 10)
    return Number.isFinite(value) && value > 0 ? value : DEFAULT_TTL_SECONDS
}

const clientIp = (ctx) =>
    ctx.headers?.['x-forwarded-for']?.split(',')[0]?.trim() || ctx.request?.ip || ctx.ip

// Denied-access events surfaced to admins (#63). One record per
// account/client/failure combination: repeats bump the counter and refresh the
// TTL instead of growing the store. Recording is best-effort and must never
// break the login flow itself.
export const recordIncident = async (ctx, {source, accountId, clientId, failure, allowedGroups, allowedUsers}) => {
    if (!incidentsEnabled()) return
    try {
        const redis = new RedisAdapter('Incident')
        const id = [source, accountId ?? 'anonymous', clientId, failure].join(':')
        const existing = await redis.find(id)
        const now = new Date().toISOString()
        await redis.upsert(id, {
            id,
            source,
            accountId,
            clientId,
            failure,
            allowedGroups: allowedGroups ?? [],
            allowedUsers: allowedUsers ?? [],
            sourceIp: clientIp(ctx),
            count: (existing?.count ?? 0) + 1,
            firstSeenAt: existing?.firstSeenAt ?? now,
            lastSeenAt: now,
        }, incidentTtlSeconds())
        await redis.appendToSet(INDEX, id)
    } catch (error) {
        globalThis.logger?.warn({error: error.message}, 'Failed to record access incident')
    }
}

export const listIncidents = async () => {
    const redis = new RedisAdapter('Incident')
    const ids = await redis.getSetMembers(INDEX) ?? []
    const incidents = []
    await Promise.all(ids.map(async (id) => {
        const incident = await redis.find(id)
        if (incident) {
            incidents.push(incident)
        } else {
            // The record expired; drop the dangling index entry.
            await redis.removeFromSet(INDEX, id)
        }
    }))
    return incidents
        .sort((a, b) => new Date(b.lastSeenAt) - new Date(a.lastSeenAt))
        .slice(0, LIST_LIMIT)
}
