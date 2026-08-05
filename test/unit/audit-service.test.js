import {afterEach, describe, expect, it, vi} from 'vitest';
import {AuditService} from '../../src/services/audit-service.js';

describe('AuditService', () => {
    afterEach(() => vi.unstubAllEnvs())

    it('emits an allow-listed structured record without credentials', () => {
        const info = vi.fn()
        const service = new AuditService({info}, () => new Date('2026-08-05T12:30:00.000Z'))
        const ctx = {
            headers: {'x-forwarded-for': '192.0.2.1', cookie: 'secret'},
            oidc: {session: {jti: 'raw-session-id'}},
            get: () => 'browser',
            state: {requestId: 'request-1'},
        }
        const record = service.write({
            event: 'application.login.succeeded',
            subject: {id: 'alice'},
            client: {id: 'apps.grafana'},
            result: 'success',
        }, ctx)

        expect(record.timestamp).toBe('2026-08-05T12:30:00.000Z')
        expect(record.request).toEqual({id: 'request-1'})
        expect(record.sessionHash).not.toBe('raw-session-id')
        expect(JSON.stringify(record)).not.toContain('secret')
        expect(info).toHaveBeenCalledWith({logType: 'audit', audit: record}, 'application.login.succeeded')
    })

    it('includes explicitly enabled personal request metadata', () => {
        vi.stubEnv('AUDIT_INCLUDE_SOURCE_ADDRESS', 'true')
        vi.stubEnv('AUDIT_INCLUDE_USER_AGENT', 'true')
        const service = new AuditService({info() {}})
        const record = service.write({event: 'test'}, {
            headers: {'x-forwarded-for': '192.0.2.1'},
            get: () => 'test-agent',
        })
        expect(record.request.sourceAddress).toBe('192.0.2.1')
        expect(record.request.userAgent).toBe('test-agent')
    })
})
