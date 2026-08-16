import {createHash} from 'node:crypto'
import {OIDCUserEventHookCrd, OIDCUserCrd} from '../utils/kubernetes/kube-constants.js'
import {KubeOwnerMetadata} from '../utils/kubernetes/kube-owner-metadata.js'

const injectedEnvironment = {
    eventType: 'PASSMOWER_EVENT_TYPE',
    resourceKind: 'PASSMOWER_RESOURCE_KIND',
    namespace: 'PASSMOWER_RESOURCE_NAMESPACE',
    name: 'PASSMOWER_RESOURCE_NAME',
    uid: 'PASSMOWER_RESOURCE_UID',
    generation: 'PASSMOWER_RESOURCE_GENERATION',
}

function matchesSelector(labels, selector = {}) {
    labels ??= {}
    if (Object.entries(selector.matchLabels ?? {}).some(([key, value]) => labels[key] !== value)) return false
    return (selector.matchExpressions ?? []).every(({key, operator, values = []}) => {
        const present = Object.hasOwn(labels, key)
        if (operator === 'In') return present && values.includes(labels[key])
        if (operator === 'NotIn') return !present || !values.includes(labels[key])
        if (operator === 'Exists') return present
        if (operator === 'DoesNotExist') return !present
        return false
    })
}

function injectEnvironment(containers = [], event) {
    const values = {
        eventType: event.type,
        resourceKind: OIDCUserCrd,
        namespace: event.user.metadata.namespace,
        name: event.user.metadata.name,
        uid: event.user.metadata.uid,
        generation: String(event.user.metadata.generation ?? 1),
    }
    for (const container of containers) {
        const injectedNames = new Set(Object.values(injectedEnvironment))
        container.env = [
            ...(container.env ?? []).filter(item => !injectedNames.has(item.name)),
            ...Object.entries(injectedEnvironment).map(([field, name]) => ({name, value: values[field]})),
        ]
    }
}

function labelValue(value) {
    const text = String(value)
    if (text.length <= 63) return text
    const digest = createHash('sha256').update(text).digest('hex').slice(0, 12)
    return `${text.slice(0, 50)}-${digest}`
}

export class OidcUserEventHook {
    fromKubernetes(resource) {
        this.resource = resource
        this.name = resource.metadata.name
        this.namespace = resource.metadata.namespace
        this.uid = resource.metadata.uid
        this.resourceVersion = resource.metadata.resourceVersion
        this.spec = resource.spec
        this.status = resource.status ?? {}
        return this
    }

    matches(event) {
        return (this.spec.events ?? []).includes(event.type)
            && matchesSelector(event.user.metadata.labels, this.spec.selector)
    }

    getJob(event) {
        const generation = String(event.user.metadata.generation ?? 1)
        const identity = [this.uid ?? this.name, event.user.metadata.uid, generation, event.type].join('\0')
        const digest = createHash('sha256').update(identity).digest('hex').slice(0, 12)
        const prefix = this.name.toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/^-+|-+$/g, '').slice(0, 35)
        const jobSpec = structuredClone(this.spec.jobSpec)
        jobSpec.template ??= {}
        jobSpec.template.spec ??= {}
        jobSpec.template.spec.restartPolicy ??= 'OnFailure'
        jobSpec.ttlSecondsAfterFinished ??= 3600
        injectEnvironment(jobSpec.template.spec.initContainers, event)
        injectEnvironment(jobSpec.template.spec.containers, event)
        return {
            apiVersion: 'batch/v1',
            kind: 'Job',
            metadata: {
                name: `${prefix}-${event.type.toLowerCase()}-${digest}`,
                namespace: this.namespace,
                ownerReferences: [new KubeOwnerMetadata(OIDCUserEventHookCrd, this.name, this.uid)],
                labels: {
                    'app.kubernetes.io/managed-by': 'passmower',
                    'app.kubernetes.io/component': 'oidc-user-event-hook',
                    'codemowers.cloud/oidc-user-event-hook': labelValue(this.name),
                    'codemowers.cloud/event': event.type.toLowerCase(),
                    'codemowers.cloud/oidc-user': labelValue(event.user.metadata.name),
                },
            },
            spec: jobSpec,
        }
    }

    getMetadata() {
        return new KubeOwnerMetadata(OIDCUserEventHookCrd, this.name, this.uid)
    }

    withAttempt(event, jobName, ready, reason, message, now = new Date()) {
        const previous = this.status.conditions?.find(condition => condition.type === 'Ready')
        const status = ready ? 'True' : 'False'
        const condition = {
            type: 'Ready', status, reason, message,
            lastTransitionTime: previous?.status === status ? previous.lastTransitionTime : now,
        }
        this.status = {
            ...this.status,
            lastAttemptedJob: {
                name: jobName,
                event: event.type,
                userName: event.user.metadata.name,
                userUID: event.user.metadata.uid,
                generation: event.user.metadata.generation ?? 1,
                attemptedAt: now,
            },
            conditions: [...(this.status.conditions ?? []).filter(item => item.type !== 'Ready'), condition],
        }
        return this.status
    }
}

export {matchesSelector}
export default OidcUserEventHook
