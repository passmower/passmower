export class ClientActivityState {
    constructor(resource) {
        this.status = {instance: null, ...resource.status}
        this.conditions = resource.status?.conditions ?? []
        this.lastUsedAt = resource.status?.lastUsedAt ?? null
        this.creationTimestamp = resource.metadata?.creationTimestamp ?? null
        this.generation = resource.metadata?.generation ?? null
        this.description = resource.metadata?.annotations?.['kubernetes.io/description'] ?? null
    }

    getIntendedStatus() {
        return {
            ...this.status,
            lastUsedAt: this.lastUsedAt,
            conditions: this.conditions,
        }
    }

    updateActivityCondition(now, inactiveAfterDays) {
        const reference = this.lastUsedAt ?? this.creationTimestamp
        if (!reference) return
        const inactive = now.getTime() - new Date(reference).getTime() >= inactiveAfterDays * 86400000
        const previous = this.conditions.find(condition => condition.type === 'Inactive')
        const status = inactive ? 'True' : 'False'
        const condition = {
            type: 'Inactive',
            status,
            reason: inactive ? 'NotUsedRecently' : 'RecentlyUsed',
            message: inactive
                ? `Client has not been used for at least ${inactiveAfterDays} days`
                : `Client was used within the last ${inactiveAfterDays} days`,
            lastTransitionTime: previous?.status === status && previous.lastTransitionTime
                ? previous.lastTransitionTime
                : now.toISOString(),
        }
        this.conditions = [...this.conditions.filter(item => item.type !== 'Inactive'), condition]
    }

    updateReadyCondition(ready, reason, message, now = new Date()) {
        const previous = this.conditions.find(condition => condition.type === 'Ready')
        const status = ready ? 'True' : 'False'
        const condition = {
            type: 'Ready',
            status,
            reason,
            message,
            lastTransitionTime: previous?.status === status ? previous.lastTransitionTime : now.toISOString(),
        }
        this.conditions = [...this.conditions.filter(item => item.type !== 'Ready'), condition]
        return !previous
            || previous.status !== status
            || previous.reason !== reason
            || previous.message !== message
    }

    // metadata.generation covers spec changes but not annotations. Description
    // is the only annotation projected into Redis, so include it to distinguish
    // status-only watch events from changes that require reconciliation.
    getReconcileFingerprint() {
        return JSON.stringify({generation: this.generation, description: this.description})
    }
}

export class ClientReconcileState {
    constructor(activityTracker) {
        this.activityTracker = activityTracker
        this.fingerprints = new Map()
    }

    register(client) {
        this.activityTracker.registerClient(client)
        this.fingerprints.set(client.getClientId(), client.getReconcileFingerprint())
    }

    shouldReconcile(client) {
        this.activityTracker.registerClient(client)
        const fingerprint = client.getReconcileFingerprint()
        const unchanged = this.fingerprints.get(client.getClientId()) === fingerprint
        this.fingerprints.set(client.getClientId(), fingerprint)
        return !unchanged
    }

    unregister(client) {
        this.activityTracker.unregisterClient(client.getClientId())
        this.fingerprints.delete(client.getClientId())
    }
}
