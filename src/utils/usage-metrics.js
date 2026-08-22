import {Counter, Gauge} from "prom-client";
import {scanKeyValues} from "../adapters/redis.js";

export const groupMetricsEnabled = (env = process.env) => env.METRICS_GROUP_MEMBERSHIP === 'true'

// Aggregate stored provider sessions into totals: every Session record counts
// as an active session; unique accountIds across them count as active users.
// Anonymous/pre-login sessions carry no accountId and only count as sessions.
export const aggregateSessionUsage = (payloads) => {
    const users = new Set()
    let sessions = 0
    for (const raw of payloads) {
        if (!raw) continue
        sessions++
        try {
            const accountId = JSON.parse(raw)?.accountId
            if (accountId) users.add(accountId)
        } catch {
            // An unreadable record still counts as a session.
        }
    }
    return {sessions, users: users.size}
}

export const countGroupMembers = (accounts) => {
    const counts = new Map()
    for (const account of accounts ?? []) {
        for (const group of account.groups ?? []) {
            const name = `${group.prefix}:${group.name}`
            counts.set(name, (counts.get(name) ?? 0) + 1)
        }
    }
    return counts
}

// Called from user reconciliation, which already holds the full account list.
// Reset before setting so removed groups do not linger with stale counts.
export const setGroupMembershipMetrics = (accounts, env = process.env) => {
    const gauge = globalThis.metrics?.groupMembers
    if (!gauge || !groupMetricsEnabled(env)) return
    gauge.reset()
    for (const [group, members] of countGroupMembers(accounts)) {
        gauge.set({group}, members)
    }
}

export const setupUsageMetrics = () => {
    globalThis.metrics.authorizationSuccess = new Counter({
        name: 'passmower_authorization_success_count',
        help: 'Successful application authorizations, by client',
        labelNames: ['client_id', 'kind'],
    })
    const activeUsers = new Gauge({
        name: 'passmower_active_users',
        help: 'Unique accounts with at least one active OIDC provider session',
    })
    new Gauge({
        name: 'passmower_active_sessions',
        help: 'Active OIDC provider sessions',
        async collect() {
            try {
                // One Redis scan per scrape feeds both gauges.
                const usage = aggregateSessionUsage(await scanKeyValues('oidc:Session:*'))
                this.set(usage.sessions)
                activeUsers.set(usage.users)
            } catch (error) {
                globalThis.logger?.warn({error: error.message}, 'Failed to collect session usage metrics')
            }
        },
    })
    if (groupMetricsEnabled()) {
        globalThis.metrics.groupMembers = new Gauge({
            name: 'passmower_group_members',
            help: 'OIDCUser accounts per group, updated on user reconciliation',
            labelNames: ['group'],
        })
    }
}
