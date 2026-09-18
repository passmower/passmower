import os from 'node:os'
import {KubernetesAdapter} from '../adapters/kubernetes.js'

export const DEFAULT_LEASE_DURATION_SECONDS = 15
export const DEFAULT_RENEW_DEADLINE_SECONDS = 10
export const DEFAULT_RETRY_PERIOD_SECONDS = 2
export const DEFAULT_LEASE_NAME = 'passmower-operators'

// Every replica runs the same Deployment, so status.instance — namespace plus
// DEPLOYMENT_NAME — is the same string in all of them. That is the right
// identity for "two Passmowers in one cluster, whose client is this" and the
// wrong one for "three pods, which of us reconciles". The pod name is the only
// thing that differs, and in a pod the hostname is the pod name.
export function podIdentity(env = process.env) {
    return env.POD_NAME || os.hostname()
}

export function isLeaderElectionEnabled(env = process.env) {
    return env.LEADER_ELECTION_ENABLED !== 'false'
}

function intEnv(name, fallback, env = process.env) {
    const value = Number.parseInt(env[name] ?? '', 10)
    return Number.isFinite(value) && value > 0 ? value : fallback
}

// A coordination.k8s.io Lease, held by one pod at a time.
//
// This is not a substitute for writers being safe on their own: a lease hands
// over on expiry as well as on a clean stop, so two holders can briefly overlap
// and whatever the loser had in flight still lands. What it buys is that the
// steady state is one reconciler rather than N.
export class LeaderElection {
    constructor({
        adapter = new KubernetesAdapter(),
        name = process.env.LEADER_ELECTION_LEASE_NAME || DEFAULT_LEASE_NAME,
        namespace = adapter.namespace,
        identity = podIdentity(),
        leaseDurationSeconds = intEnv('LEADER_LEASE_DURATION_SECONDS', DEFAULT_LEASE_DURATION_SECONDS),
        renewDeadlineSeconds = intEnv('LEADER_RENEW_DEADLINE_SECONDS', DEFAULT_RENEW_DEADLINE_SECONDS),
        retryPeriodSeconds = intEnv('LEADER_RETRY_PERIOD_SECONDS', DEFAULT_RETRY_PERIOD_SECONDS),
        onStartedLeading = async () => {},
        onStoppedLeading = async () => {},
        now = () => new Date(),
    } = {}) {
        this.adapter = adapter
        this.name = name
        this.namespace = namespace
        this.identity = identity
        this.leaseDurationSeconds = leaseDurationSeconds
        this.renewDeadlineSeconds = renewDeadlineSeconds
        this.retryPeriodSeconds = retryPeriodSeconds
        this.onStartedLeading = onStartedLeading
        this.onStoppedLeading = onStoppedLeading
        this.now = now
        this.leading = false
        this.timer = null
        this.ticking = false
        this.lastRenewedAt = null
        this.stopped = false
    }

    start() {
        if (this.timer) {
            return
        }
        this.stopped = false
        this.timer = setInterval(() => this.#tickQuietly(), this.retryPeriodSeconds * 1000)
        this.timer.unref?.()
        return this.#tickQuietly()
    }

    // Release the lease on the way out so the next holder does not have to wait
    // for it to expire. Without this a single-replica restart leaves the cluster
    // unreconciled for a whole lease duration for no reason.
    async stop() {
        this.stopped = true
        clearInterval(this.timer)
        this.timer = null
        if (!this.leading) {
            return
        }
        try {
            const lease = await this.adapter.getLease(this.namespace, this.name)
            if (lease?.spec?.holderIdentity === this.identity) {
                await this.adapter.replaceLease(this.namespace, this.name, {
                    ...lease,
                    spec: {...lease.spec, holderIdentity: null, renewTime: null},
                })
            }
        } catch (error) {
            globalThis.logger?.warn({error}, 'Could not release the operator lease')
        }
        await this.#stopLeading()
    }

    #tickQuietly() {
        if (this.ticking) {
            return
        }
        this.ticking = true
        return this.tick()
            .catch((error) => globalThis.logger?.error({error}, 'Leader election tick failed'))
            .finally(() => { this.ticking = false })
    }

    // One pass of the algorithm: read the lease, then create, renew, take over
    // or stand down. Public because it is the unit worth testing directly —
    // start() only puts it on a timer.
    async tick() {
        if (this.stopped) {
            return
        }
        let lease
        try {
            lease = await this.adapter.getLease(this.namespace, this.name)
        } catch (error) {
            return await this.#handleApiError(error, 'read')
        }
        if (!lease) {
            return await this.#acquire(null)
        }
        if (lease.spec?.holderIdentity === this.identity) {
            return await this.#renew(lease)
        }
        if (this.#expired(lease)) {
            return await this.#acquire(lease)
        }
        // Someone else holds a live lease. If that someone was us, our renewals
        // have been failing long enough for them to take over.
        await this.#stopLeading()
    }

    #expired(lease) {
        const renewTime = lease.spec?.renewTime
        if (!lease.spec?.holderIdentity || !renewTime) {
            return true
        }
        const duration = (lease.spec.leaseDurationSeconds ?? this.leaseDurationSeconds) * 1000
        return this.now().getTime() - new Date(renewTime).getTime() > duration
    }

    async #acquire(existing) {
        const timestamp = this.now().toISOString()
        const spec = {
            holderIdentity: this.identity,
            leaseDurationSeconds: this.leaseDurationSeconds,
            acquireTime: timestamp,
            renewTime: timestamp,
            leaseTransitions: (existing?.spec?.leaseTransitions ?? 0) + 1,
        }
        try {
            if (existing) {
                await this.adapter.replaceLease(this.namespace, this.name, {...existing, spec})
            } else {
                await this.adapter.createLease(this.namespace, {
                    metadata: {name: this.name, namespace: this.namespace},
                    spec,
                })
            }
        } catch (error) {
            const code = error.code ?? error.statusCode
            if (code === 409) {
                // Another pod got there first in the same instant. Nothing to
                // report — the next tick reads whatever they wrote.
                return await this.#stopLeading()
            }
            return await this.#handleApiError(error, 'acquire')
        }
        this.lastRenewedAt = this.now()
        await this.#startLeading()
    }

    async #renew(lease) {
        try {
            await this.adapter.replaceLease(this.namespace, this.name, {
                ...lease,
                spec: {...lease.spec, renewTime: this.now().toISOString(), leaseDurationSeconds: this.leaseDurationSeconds},
            })
        } catch (error) {
            const code = error.code ?? error.statusCode
            if (code === 409) {
                // A conflicting write means the lease moved under us; the next
                // tick sees the new holder. Give up only once the renew deadline
                // has passed, so a single lost race does not stop the operators.
                return await this.#failRenewal()
            }
            await this.#handleApiError(error, 'renew')
            return await this.#failRenewal()
        }
        this.lastRenewedAt = this.now()
        await this.#startLeading()
    }

    async #failRenewal() {
        if (!this.leading) {
            return
        }
        const since = this.lastRenewedAt ? this.now().getTime() - this.lastRenewedAt.getTime() : Infinity
        if (since > this.renewDeadlineSeconds * 1000) {
            globalThis.logger?.warn(
                {lease: this.name, identity: this.identity},
                'Could not renew the operator lease within the renew deadline, standing down')
            await this.#stopLeading()
        }
    }

    // Missing RBAC would otherwise leave the operators permanently stopped on an
    // upgrade that took the image but not the chart. Passmower with no
    // reconciler is far worse than Passmower with several, which is what every
    // release before leader election did, so say so loudly and carry on.
    async #handleApiError(error, action) {
        const code = error.code ?? error.statusCode
        if (code === 403 || code === 401) {
            globalThis.logger?.error(
                {error, lease: this.name, namespace: this.namespace},
                `Not allowed to ${action} the operator lease — grant coordination.k8s.io leases (upgrade the chart) `
                + 'or set LEADER_ELECTION_ENABLED=false. Running the operators without leader election.')
            clearInterval(this.timer)
            this.timer = null
            return await this.#startLeading()
        }
        throw error
    }

    async #startLeading() {
        if (this.leading) {
            return
        }
        this.leading = true
        globalThis.logger?.info({lease: this.name, identity: this.identity}, 'Acquired the operator lease')
        await this.onStartedLeading()
    }

    async #stopLeading() {
        if (!this.leading) {
            return
        }
        this.leading = false
        globalThis.logger?.warn({lease: this.name, identity: this.identity}, 'Lost the operator lease')
        await this.onStoppedLeading()
    }
}

export default LeaderElection
