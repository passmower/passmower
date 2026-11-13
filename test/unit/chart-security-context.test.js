import {readFileSync} from 'node:fs'
import {load} from 'js-yaml'
import {describe, expect, it} from 'vitest'

const url = (file) => new URL(`../../charts/passmower/${file}`, import.meta.url)
const values = load(readFileSync(url('values.yaml'), 'utf8'))
const template = (file) => readFileSync(url(file), 'utf8')

// What Pod Security "restricted" checks on a pod and each of its containers.
const expectRestrictedPod = (pod) => {
    expect(pod.runAsNonRoot).toBe(true)
    expect(pod.runAsUser).toBeGreaterThan(0)
    expect(pod.seccompProfile).toEqual({type: 'RuntimeDefault'})
}
const expectRestrictedContainer = (container) => {
    expect(container.allowPrivilegeEscalation).toBe(false)
    expect(container.capabilities).toEqual({drop: ['ALL']})
    expect(container.readOnlyRootFilesystem).toBe(true)
}

describe('the chart under Pod Security "restricted"', () => {
    it('runs Passmower and its key-manager Job unprivileged by default', () => {
        expectRestrictedPod(values.podSecurityContext)
        expectRestrictedContainer(values.securityContext)
        expect(values.podSecurityContext.runAsUser).toBe(1000)
        expect(values.podSecurityContext.runAsGroup).toBe(1000)
        // The image's node user; non-root wherever no pod-level UID is set.
        expect(template('../../Dockerfile')).toMatch(/^USER 1000:1000$/m)
    })

    it.each(['templates/deployment.yaml', 'templates/pre-install.yaml'])('applies both contexts in %s', (file) => {
        expect(template(file)).toContain('toYaml .Values.podSecurityContext')
        expect(template(file)).toContain('toYaml .Values.securityContext')
    })

    it('runs the bundled Redis unprivileged with a writable /data', () => {
        const {podSecurityContext, securityContext} = values.redis.internal
        expectRestrictedPod(podSecurityContext)
        expectRestrictedContainer(securityContext)
        // UID 999 / GID 1000 in both the Valkey and redis:*-alpine images.
        expect(podSecurityContext).toMatchObject({runAsUser: 999, runAsGroup: 1000, fsGroup: 1000})

        const redis = template('templates/redis.yaml')
        expect(redis).toContain('.Values.redis.internal.podSecurityContext')
        expect(redis).toContain('.Values.redis.internal.securityContext')
        expect(redis).toMatch(/workingDir: \/data/)
        expect(redis).toMatch(/mountPath: \/data/)
        expect(redis).toMatch(/emptyDir: \{\}/)
    })

    it('inherits restricted defaults for the local production image', () => {
        const local = load(template('values.local.yaml'))
        expect(local.podSecurityContext).toBeUndefined()
        expect(local.securityContext).toBeUndefined()
    })
})
