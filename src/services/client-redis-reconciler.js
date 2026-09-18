import RedisAdapter from '../adapters/redis.js'
import {KubernetesAdapter} from '../adapters/kubernetes.js'
import {NamespaceFilter} from '../utils/kubernetes/namespace-filter.js'
import {OIDCClientCrd, OIDCMiddlewareClientCrd} from '../utils/kubernetes/kube-constants.js'
import OidcClient from '../models/oidc-client.js'
import OidcMiddlewareClient from '../models/oidc-middleware-client.js'

export const DEFAULT_RECONCILE_INTERVAL_MS = 5 * 60 * 1000

// Both kinds share the 'Client' Redis model and the 'Clients' set, so they are
// swept together. A sweep that knew about only one of them would find every
// record of the other unaccounted for and delete it.
const sweptKinds = {
    [OIDCClientCrd]: (incoming) => (new OidcClient()).fromIncomingClient(incoming),
    [OIDCMiddlewareClientCrd]: (incoming) => (new OidcMiddlewareClient()).fromIncomingClient(incoming),
}

export function getReconcileIntervalMs(env = process.env) {
    const raw = env.RECONCILE_INTERVAL_MS
    if (!raw) {
        return DEFAULT_RECONCILE_INTERVAL_MS
    }
    const parsed = Number(raw)
    if (!Number.isInteger(parsed) || parsed < 0) {
        throw new Error('RECONCILE_INTERVAL_MS must be a non-negative integer (0 disables the sweep)')
    }
    return parsed
}

// Garbage-collects Redis client records whose custom resource is gone.
//
// The watch is the only thing that removes a record, via its DELETED callback,
// and a DELETED that is never delivered or never applied is never retried —
// unlike a create or update, which every watch reconnect replays as part of its
// initial LIST. So Redis converges upwards on its own and only ever drifts
// upwards: clients outlive their CRs and keep appearing in the launcher (#257).
//
// This only ever deletes. Re-creating records here would duplicate what the
// watch already replays, and with no leader election (#236) every replica runs
// its own sweep, so an upsert from a stale read would be a second way to
// resurrect a client rather than a repair.
export class ClientRedisReconciler {
    constructor(
        adapter = new KubernetesAdapter(),
        redisAdapter = new RedisAdapter('Client'),
        {intervalMs = getReconcileIntervalMs()} = {},
    ) {
        this.adapter = adapter
        this.redisAdapter = redisAdapter
        this.clientsRedis = new RedisAdapter('Clients')
        this.namespaceFilter = new NamespaceFilter(this.adapter.namespace)
        this.intervalMs = intervalMs
        this.timer = undefined
        this.running = false
    }

    start() {
        if (this.timer || this.intervalMs === 0) {
            return
        }
        this.timer = setInterval(() => this.#sweepQuietly(), this.intervalMs)
        this.timer.unref?.()
        // Once at startup too: a delete missed while this pod was down is
        // exactly the gap nothing else closes.
        this.#sweepQuietly()
    }

    stop() {
        clearInterval(this.timer)
        this.timer = undefined
    }

    #sweepQuietly() {
        this.sweep().catch((error) => {
            globalThis.logger.error({error}, 'Client reconcile sweep failed')
        })
    }

    // Returns the client ids removed, so tests and callers can assert on the
    // sweep rather than on the Redis state it leaves behind.
    async sweep() {
        if (this.running) {
            return []
        }
        this.running = true
        try {
            const live = await this.#listLiveClientIds()
            if (!live) {
                // A failed LIST is indistinguishable from an empty cluster once
                // it is a Set of ids, and acting on that would delete every
                // client there is. Skip this round instead.
                return []
            }
            return await this.#removeOrphans(live)
        } finally {
            this.running = false
        }
    }

    // The ids of every client resource in scope, or undefined if any of the
    // lists failed.
    async #listLiveClientIds() {
        const live = new Set()
        for (const [kind, mapperFunction] of Object.entries(sweptKinds)) {
            const clients = this.namespaceFilter.namespace
                ? await this.adapter.listNamespacedCustomObject(
                    kind, this.namespaceFilter.namespace, mapperFunction)
                : await this.adapter.listClusterCustomObject(kind, mapperFunction)
            if (!Array.isArray(clients)) {
                globalThis.logger.warn({kind}, 'Client reconcile sweep skipped: could not list resources')
                return undefined
            }
            for (const client of clients) {
                if (this.namespaceFilter.filter(client.getClientNamespace())) {
                    live.add(client.getClientId())
                }
            }
        }
        return live
    }

    async #removeOrphans(live) {
        const removed = []
        for (const id of await this.clientsRedis.getSetMembers(1)) {
            if (live.has(id)) {
                continue
            }
            const record = await this.redisAdapter.find(id)
            if (!record) {
                // A set member whose record has already expired or been deleted.
                // destroy() falls back to the default owner for a missing
                // payload, which is what drops it from the set.
                await this.redisAdapter.destroy(id)
                removed.push(id)
                continue
            }
            if (!(record.kind in sweptKinds)) {
                // Some other kind's record sharing the set — not ours to judge.
                continue
            }
            if (!this.namespaceFilter.filter(record.clientNamespace)) {
                // Out of scope, so its absence from `live` says nothing about
                // whether the resource exists. Another instance owns it.
                continue
            }
            if (!await this.#confirmAbsent(record)) {
                continue
            }
            await this.redisAdapter.destroy(id)
            removed.push(id)
            globalThis.logger.info(
                {client: id, kind: record.kind},
                'Client reconcile sweep removed a Redis record with no custom resource')
        }
        return removed
    }

    // Re-read the single resource before deleting its record. The list is a
    // snapshot, so a client created just after it was taken would otherwise look
    // like an orphan and be deleted — and nothing would put it back until the
    // next watch reconnect, up to WATCH_TIMEOUT_MS later.
    async #confirmAbsent(record) {
        const found = await this.adapter.getNamespacedCustomObject(
            record.kind,
            record.clientNamespace,
            record.client_name,
            (incoming) => incoming,
        )
        // undefined is a 404; null is a failed request, which is not evidence of
        // absence. Only the former justifies a delete.
        return found === undefined
    }
}
