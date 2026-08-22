import RedisAdapter from "../../adapters/redis.js";
import {incidentTtlSeconds} from "./incident-log.js";

const INDEX = 'index'
const LIST_LIMIT = 100

export const groupRequestsEnabled = (env = process.env) => env.GROUP_REQUESTS_ENABLED === 'true'

// Group-membership requests (#44). Only offered when the client actually gates
// on groups, and — unless the deployment relaxes it — only to accounts that
// already belong to at least one group, so a blank enrollment cannot spam
// administrators with requests.
export const canRequestAccess = (account, client, env = process.env) => {
    if (!groupRequestsEnabled(env)) return false
    if (!client?.allowedGroups?.length) return false
    if (env.GROUP_REQUESTS_REQUIRE_EXISTING_GROUP !== 'false' && !(account?.groups ?? []).length) return false
    return true
}

// One record per account/client; repeats bump the counter and refresh the TTL
// (shared with incident retention).
export const recordAccessRequest = async ({accountId, clientId, allowedGroups}) => {
    const redis = new RedisAdapter('AccessRequest')
    const id = `${accountId}:${clientId}`
    const existing = await redis.find(id)
    const now = new Date().toISOString()
    await redis.upsert(id, {
        id,
        accountId,
        clientId,
        allowedGroups: allowedGroups ?? [],
        count: (existing?.count ?? 0) + 1,
        firstRequestedAt: existing?.firstRequestedAt ?? now,
        lastRequestedAt: now,
    }, incidentTtlSeconds())
    await redis.appendToSet(INDEX, id)
}

export const listAccessRequests = async () => {
    const redis = new RedisAdapter('AccessRequest')
    const ids = await redis.getSetMembers(INDEX) ?? []
    const requests = []
    await Promise.all(ids.map(async (id) => {
        const request = await redis.find(id)
        if (request) {
            requests.push(request)
        } else {
            await redis.removeFromSet(INDEX, id)
        }
    }))
    return requests
        .sort((a, b) => new Date(b.lastRequestedAt) - new Date(a.lastRequestedAt))
        .slice(0, LIST_LIMIT)
}

export const dismissAccessRequest = async (id) => {
    const redis = new RedisAdapter('AccessRequest')
    await redis.destroy(id)
    await redis.removeFromSet(INDEX, id)
}
