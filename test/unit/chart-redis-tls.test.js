import {readFileSync} from 'node:fs'
import {load} from 'js-yaml'
import {describe, expect, it} from 'vitest'

const deployment = readFileSync(
    new URL('../../charts/passmower/templates/deployment.yaml', import.meta.url), 'utf8')
const values = load(readFileSync(
    new URL('../../charts/passmower/values.yaml', import.meta.url), 'utf8'))

// Managed Redis offerings require TLS, and the sliced host settings always
// produced a redis:// URL with no way to ask for anything else (#281).
describe('external Redis TLS', () => {
    it('is off by default with every knob declared', () => {
        expect(values.redis.external.tls).toEqual({
            enabled: false,
            servername: '',
            caSecretKeyRef: {name: '', key: 'ca.crt'},
            insecureSkipVerify: false,
        })
    })

    it('threads every TLS env var the adapter reads', () => {
        for (const name of ['REDIS_TLS', 'REDIS_TLS_SERVERNAME', 'REDIS_TLS_CA_FILE', 'REDIS_TLS_INSECURE_SKIP_VERIFY']) {
            expect(deployment).toContain(`- name: ${name}`)
        }
    })

    it('mounts the CA Secret where REDIS_TLS_CA_FILE points', () => {
        expect(deployment).toContain('value: /etc/passmower/redis-tls/{{ .caSecretKeyRef.key }}')
        expect(deployment).toContain('mountPath: /etc/passmower/redis-tls')
        expect(deployment).toContain('secretName: {{ .Values.redis.external.tls.caSecretKeyRef.name }}')
    })
})
