import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { apiServerUrlViaServiceDns } from '../../src/adapters/kubernetes.js'

// loadFromCluster() connects to the bare KUBERNETES_SERVICE_HOST, which on
// IPv6 clusters is a literal address the API server cert may not carry as an
// IP SAN. apiServerUrlViaServiceDns() decides whether to swap in the
// kubernetes.default.svc DNS name (always in the cert SANs) instead.
describe('apiServerUrlViaServiceDns — IPv6 API server TLS SAN workaround', () => {
    beforeEach(() => {
        delete process.env.KUBERNETES_SERVICE_HOST
        delete process.env.KUBERNETES_SERVICE_PORT
        delete process.env.KUBERNETES_API_SERVICE_DNS
    })
    afterEach(() => {
        delete process.env.KUBERNETES_SERVICE_HOST
        delete process.env.KUBERNETES_SERVICE_PORT
        delete process.env.KUBERNETES_API_SERVICE_DNS
    })

    it('auto: rewrites to service DNS when the host is an IPv6 literal', () => {
        expect(apiServerUrlViaServiceDns({ host: 'fd00::1', port: '443' }))
            .toBe('https://kubernetes.default.svc:443')
    })

    it('auto: leaves IPv4 clusters untouched', () => {
        expect(apiServerUrlViaServiceDns({ host: '10.96.0.1', port: '443' })).toBeNull()
    })

    it('never: disables the rewrite even on IPv6', () => {
        expect(apiServerUrlViaServiceDns({ host: 'fd00::1', port: '443', mode: 'never' })).toBeNull()
    })

    it('always: forces the rewrite even on IPv4', () => {
        expect(apiServerUrlViaServiceDns({ host: '10.96.0.1', port: '443', mode: 'always' }))
            .toBe('https://kubernetes.default.svc:443')
    })

    it('preserves the port and picks http for the plain-text API ports', () => {
        expect(apiServerUrlViaServiceDns({ host: 'fd00::1', port: '8080' }))
            .toBe('http://kubernetes.default.svc:8080')
    })

    it('returns null when not running in a cluster (no host)', () => {
        expect(apiServerUrlViaServiceDns({ host: undefined, port: '443' })).toBeNull()
    })

    it('reads host/port/mode from the environment by default', () => {
        process.env.KUBERNETES_SERVICE_HOST = 'fd00::1'
        process.env.KUBERNETES_SERVICE_PORT = '443'
        expect(apiServerUrlViaServiceDns()).toBe('https://kubernetes.default.svc:443')
    })
})
