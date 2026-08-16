import {describe, expect, it} from 'vitest'
import {OidcUserEventHook, matchesSelector} from '../../src/models/oidc-user-event-hook.js'

function hook(overrides = {}) {
    return new OidcUserEventHook().fromKubernetes({
        metadata: {name: 'directory-sync', namespace: 'users', uid: 'hook-uid', resourceVersion: '1'},
        spec: {
            events: ['Added', 'Modified', 'Deleted'],
            selector: {matchLabels: {tenant: 'acme'}},
            jobSpec: {
                template: {
                    spec: {
                        containers: [{name: 'sync', image: 'example/sync', env: [{name: 'EXISTING', value: 'yes'}]}],
                        initContainers: [{name: 'prepare', image: 'example/prepare'}],
                    },
                },
            },
        },
        status: {},
        ...overrides,
    })
}

function event(type = 'Added', overrides = {}) {
    return {
        type,
        user: {
            apiVersion: 'codemowers.cloud/v1', kind: 'OIDCUser',
            metadata: {
                name: 'alice', namespace: 'users', uid: 'user-uid', generation: 3,
                labels: {tenant: 'acme', active: 'true'},
                ...overrides,
            },
            spec: {email: 'alice@example.com'},
        },
    }
}

describe('OIDCUserEventHook model', () => {
    it('matches Kubernetes LabelSelector expressions', () => {
        const labels = {tenant: 'acme', active: 'true'}
        expect(matchesSelector(labels, {matchLabels: {tenant: 'acme'}})).toBe(true)
        expect(matchesSelector(labels, {matchExpressions: [
            {key: 'tenant', operator: 'In', values: ['acme']},
            {key: 'deleted', operator: 'DoesNotExist'},
            {key: 'active', operator: 'Exists'},
        ]})).toBe(true)
        expect(matchesSelector(labels, {matchExpressions: [
            {key: 'tenant', operator: 'NotIn', values: ['acme']},
        ]})).toBe(false)
    })

    it('builds a deterministic, owned and labelled Job with non-sensitive metadata', () => {
        const model = hook()
        const first = model.getJob(event())
        const replay = model.getJob(event())

        expect(replay.metadata.name).toBe(first.metadata.name)
        expect(first.metadata).toMatchObject({
            namespace: 'users',
            ownerReferences: [{kind: 'OIDCUserEventHook', name: 'directory-sync', uid: 'hook-uid'}],
            labels: {
                'app.kubernetes.io/managed-by': 'passmower',
                'app.kubernetes.io/component': 'oidc-user-event-hook',
                'codemowers.cloud/oidc-user-event-hook': 'directory-sync',
                'codemowers.cloud/event': 'added',
                'codemowers.cloud/oidc-user': 'alice',
            },
        })
        expect(first.spec.template.spec.restartPolicy).toBe('OnFailure')
        expect(first.spec.ttlSecondsAfterFinished).toBe(3600)
        for (const container of [...first.spec.template.spec.containers, ...first.spec.template.spec.initContainers]) {
            expect(Object.fromEntries(container.env.map(item => [item.name, item.value]))).toMatchObject({
                PASSMOWER_EVENT_TYPE: 'Added',
                PASSMOWER_RESOURCE_KIND: 'OIDCUser',
                PASSMOWER_RESOURCE_NAMESPACE: 'users',
                PASSMOWER_RESOURCE_NAME: 'alice',
                PASSMOWER_RESOURCE_UID: 'user-uid',
                PASSMOWER_RESOURCE_GENERATION: '3',
            })
            expect(JSON.stringify(container.env)).not.toContain('alice@example.com')
        }
    })

    it('changes the Job identity across generation and event type', () => {
        const model = hook()
        const names = new Set([
            model.getJob(event('Added')).metadata.name,
            model.getJob(event('Modified')).metadata.name,
            model.getJob(event('Modified', {generation: 4})).metadata.name,
            model.getJob(event('Deleted', {generation: 4})).metadata.name,
        ])
        expect(names.size).toBe(4)
    })
})
