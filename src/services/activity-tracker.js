import {OIDCClientCrd, OIDCMiddlewareClientCrd, OIDCUserCrd} from '../utils/kubernetes/kube-constants.js';
import Account from '../models/account.js';
import OidcClient from '../models/oidc-client.js';
import OidcMiddlewareClient from '../models/oidc-middleware-client.js';
import {KubernetesAdapter} from '../adapters/kubernetes.js';

const DEFAULT_FLUSH_INTERVAL_SECONDS = 900
const DEFAULT_RECENT_APPLICATION_LIMIT = 20

function intEnv(name, fallback) {
    const value = Number.parseInt(process.env[name] ?? '', 10)
    return Number.isFinite(value) && value > 0 ? value : fallback
}

function newer(a, b) {
    if (!a) return b
    if (!b) return a
    return new Date(a) >= new Date(b) ? a : b
}

function newestActivity(a, b) {
    if (!a) return b
    if (!b) return a
    return newer(a.lastAuthenticatedAt, b.lastAuthenticatedAt) === a.lastAuthenticatedAt ? a : b
}

export class ActivityTracker {
    constructor({adapter = new KubernetesAdapter(), now = () => new Date()} = {}) {
        this.adapter = adapter
        this.now = now
        this.pendingUsers = new Map()
        this.pendingClients = new Map()
        this.knownClients = new Map()
        this.timer = null
    }

    record({accountId, clientId, clientNamespace, clientName, clientKind = OIDCClientCrd, userAuthenticated = true, timestamp = this.now().toISOString()}) {
        if (!clientId || !clientNamespace || !clientName) return
        const client = {clientId, clientNamespace, clientName, clientKind, lastAuthenticatedAt: timestamp}
        this.pendingClients.set(clientId, {...client, lastAuthenticatedAt: newer(this.pendingClients.get(clientId)?.lastAuthenticatedAt, timestamp)})
        if (accountId && userAuthenticated) {
            const applications = this.pendingUsers.get(accountId) ?? new Map()
            applications.set(clientId, {...client, lastAuthenticatedAt: newer(applications.get(clientId)?.lastAuthenticatedAt, timestamp)})
            this.pendingUsers.set(accountId, applications)
        }
    }

    registerClient(client) {
        this.knownClients.set(client.getClientId(), {
            clientId: client.getClientId(),
            clientNamespace: client.getClientNamespace(),
            clientName: client.getClientName(),
            clientKind: client.getKind(),
        })
    }

    unregisterClient(clientId) {
        const client = this.knownClients.get(clientId)
        if (client) {
            globalThis.metrics?.oidcClientLastUsed?.remove({
                kind: client.clientKind,
                namespace: client.clientNamespace,
                client: client.clientName,
            })
        }
        this.knownClients.delete(clientId)
    }

    start() {
        if (process.env.ACTIVITY_TRACKING_ENABLED === 'false' || this.timer) return
        this.timer = setInterval(() => this.flush().catch(err => {
            globalThis.logger?.error({err}, 'Failed to flush OIDC activity')
        }), intEnv('ACTIVITY_FLUSH_INTERVAL_SECONDS', DEFAULT_FLUSH_INTERVAL_SECONDS) * 1000)
        this.timer.unref()
    }

    stop() {
        clearInterval(this.timer)
        this.timer = null
    }

    async flush() {
        if (process.env.ACTIVITY_TRACKING_ENABLED === 'false') return
        const users = this.pendingUsers
        const clients = this.pendingClients
        this.pendingUsers = new Map()
        this.pendingClients = new Map()
        const errors = []
        for (const [accountId, applications] of users) {
            try {
                await this.#flushUser(accountId, applications)
            } catch (err) {
                const pending = this.pendingUsers.get(accountId) ?? new Map()
                for (const [clientId, app] of applications) {
                    pending.set(clientId, newestActivity(pending.get(clientId), app))
                }
                this.pendingUsers.set(accountId, pending)
                errors.push(err)
            }
        }
        const clientIds = new Set([...this.knownClients.keys(), ...clients.keys()])
        for (const clientId of clientIds) {
            try {
                await this.#flushClient(clientId, clients.get(clientId))
            } catch (err) {
                const activity = clients.get(clientId)
                if (activity) {
                    this.pendingClients.set(clientId, newestActivity(this.pendingClients.get(clientId), activity))
                }
                errors.push(err)
            }
        }
        if (errors.length) throw new AggregateError(errors, `Failed to flush ${errors.length} OIDC activity projection(s)`)
    }

    async #flushUser(accountId, applications) {
        const account = await this.adapter.getNamespacedCustomObject(
            OIDCUserCrd, this.adapter.namespace, accountId,
            raw => new Account().fromKubernetes(raw)
        )
        if (!account) return
        const merged = new Map(account.getRecentApplications().map(app => [app.clientId, app]))
        for (const [clientId, app] of applications) {
            const previous = merged.get(clientId)
            merged.set(clientId, {...app, lastAuthenticatedAt: newer(previous?.lastAuthenticatedAt, app.lastAuthenticatedAt)})
        }
        const recent = [...merged.values()]
            .sort((a, b) => new Date(b.lastAuthenticatedAt) - new Date(a.lastAuthenticatedAt))
            .slice(0, intEnv('ACTIVITY_RECENT_APPLICATION_LIMIT', DEFAULT_RECENT_APPLICATION_LIMIT))
        account.setRecentApplications(recent)
        const updated = await this.adapter.replaceNamespacedCustomObjectStatus(
            OIDCUserCrd, this.adapter.namespace, accountId, account.resourceVersion,
            account.getIntendedStatus(), raw => new Account().fromKubernetes(raw)
        )
        if (!updated) throw new Error(`Failed to update activity status for OIDCUser ${accountId}`)
    }

    async #flushClient(clientId, activity) {
        const known = activity ?? this.knownClients.get(clientId)
        if (!known) return
        const kind = known.clientKind === OIDCMiddlewareClientCrd ? OIDCMiddlewareClientCrd : OIDCClientCrd
        const Model = kind === OIDCMiddlewareClientCrd ? OidcMiddlewareClient : OidcClient
        const client = await this.adapter.getNamespacedCustomObject(
            kind, known.clientNamespace, known.clientName,
            raw => new Model().fromIncomingClient(raw)
        )
        if (!client) return
        const previousLastUsedAt = client.getLastUsedAt()
        const previousConditions = JSON.stringify(client.getConditions())
        if (activity) client.setLastUsedAt(newer(client.getLastUsedAt(), activity.lastAuthenticatedAt))
        client.updateActivityCondition(this.now(), intEnv('CLIENT_INACTIVE_AFTER_DAYS', 90))
        const value = client.getLastUsedAt() ? new Date(client.getLastUsedAt()).getTime() / 1000 : 0
        globalThis.metrics?.oidcClientLastUsed?.set({kind, namespace: known.clientNamespace, client: known.clientName}, value)
        const changed = previousLastUsedAt !== client.getLastUsedAt()
            || previousConditions !== JSON.stringify(client.getConditions())
        if (changed) {
            const updated = await this.adapter.replaceNamespacedCustomObjectStatus(
                kind, known.clientNamespace, known.clientName, client.getResourceVersion(),
                client.getIntendedStatus(), raw => new Model().fromIncomingClient(raw)
            )
            if (!updated) throw new Error(`Failed to update activity status for OIDCClient ${clientId}`)
        }
    }
}

let tracker

export function getActivityTracker(options) {
    if (!tracker || options) tracker = new ActivityTracker(options)
    return tracker
}

export function resetActivityTracker() {
    tracker?.stop()
    tracker = undefined
}
