import {randomUUID, createHash} from 'node:crypto';
import {parseRequestMetadata} from '../utils/session/parse-request-headers.js';

function hash(value) {
    if (!value) return undefined
    return createHash('sha256').update(String(value)).digest('hex')
}

export class AuditService {
    constructor(logger = globalThis.logger, now = () => new Date()) {
        this.logger = logger
        this.now = now
    }

    write(event, ctx) {
        if (process.env.AUDIT_ENABLED === 'false') return
        const includeSourceAddress = process.env.AUDIT_INCLUDE_SOURCE_ADDRESS === 'true'
        const includeUserAgent = process.env.AUDIT_INCLUDE_USER_AGENT === 'true'
        const request = includeSourceAddress
            ? parseRequestMetadata(ctx?.headers ?? {}, undefined, undefined)
            : undefined
        const record = {
            schemaVersion: 1,
            eventId: randomUUID(),
            timestamp: this.now().toISOString(),
            ...event,
            request: {
                id: ctx?.state?.requestId ?? ctx?.get?.('x-request-id') ?? undefined,
                sourceAddress: includeSourceAddress ? request?.ip : undefined,
                userAgent: includeUserAgent ? ctx?.get?.('user-agent') : undefined,
            },
            sessionHash: hash(ctx?.oidc?.session?.jti ?? ctx?.currentSession?.jti),
        }
        this.logger?.info({logType: 'audit', audit: record}, event.event)
        return record
    }
}

export default AuditService
