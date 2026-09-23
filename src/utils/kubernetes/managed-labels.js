// Labels an operator asks to be stamped on everything Passmower creates at
// runtime — OIDCUsers, discovered OIDCClients, client Secrets, Jobs — from
// MANAGED_RESOURCE_LABELS, a JSON object the chart fills from commonLabels
// when commonLabelsOnManagedResources is on.
//
// They sit beneath every label Passmower sets itself: those are how the
// operators, the PrometheusRule and ClaimedBy find their objects again, so a
// managed label must never be able to replace one.
export function parseManagedResourceLabels(raw = process.env.MANAGED_RESOURCE_LABELS) {
    if (raw === undefined || raw.trim() === '') {
        return {}
    }
    let labels
    try {
        labels = JSON.parse(raw)
    } catch (error) {
        throw new Error(`MANAGED_RESOURCE_LABELS is not valid JSON: ${error.message}`)
    }
    if (labels === null || typeof labels !== 'object' || Array.isArray(labels)) {
        throw new Error('MANAGED_RESOURCE_LABELS must be a JSON object of label names to values')
    }
    for (const [key, value] of Object.entries(labels)) {
        if (typeof value !== 'string') {
            throw new Error(`MANAGED_RESOURCE_LABELS: the value of "${key}" must be a string`)
        }
    }
    return labels
}

// With nothing configured the caller's labels pass through untouched, so an
// install that leaves this off sends exactly what it did before.
export function withManagedLabels(managedLabels = {}, labels) {
    if (!Object.keys(managedLabels).length) {
        return labels
    }
    return {...managedLabels, ...(labels ?? {})}
}

// On the pod template too: label policies are usually enforced on Pods.
export function withManagedJobLabels(managedLabels = {}, jobManifest) {
    if (!Object.keys(managedLabels).length) {
        return jobManifest
    }
    const template = jobManifest.spec?.template ?? {}
    return {
        ...jobManifest,
        metadata: {
            ...jobManifest.metadata,
            labels: withManagedLabels(managedLabels, jobManifest.metadata?.labels),
        },
        spec: {
            ...jobManifest.spec,
            template: {
                ...template,
                metadata: {
                    ...template.metadata,
                    labels: withManagedLabels(managedLabels, template.metadata?.labels),
                },
            },
        },
    }
}
