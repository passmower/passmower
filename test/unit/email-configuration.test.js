import {describe, expect, it} from 'vitest'
import {isOutboundEmailEnabled, validateEmailConfiguration} from '../../src/utils/email-configuration.js'

const configured = {
    EMAIL_ENABLED: 'true',
    EMAIL_HOST: 'smtp.example.com',
    EMAIL_PORT: '587',
    EMAIL_SSL: 'false',
    EMAIL_USERNAME: 'passmower',
    EMAIL_PASSWORD: 'secret',
}

describe('email configuration', () => {
    it('defaults to enabled and validates every documented SMTP setting', () => {
        expect(isOutboundEmailEnabled({})).toBe(true)
        expect(() => validateEmailConfiguration(configured)).not.toThrow()
        expect(() => validateEmailConfiguration({...configured, EMAIL_HOST: ''}))
            .toThrow(/EMAIL_HOST/)
    })

    it('has no SMTP configuration dependency when explicitly disabled', () => {
        expect(isOutboundEmailEnabled({EMAIL_ENABLED: 'false'})).toBe(false)
        expect(() => validateEmailConfiguration({EMAIL_ENABLED: 'false'})).not.toThrow()
    })

    it('accepts unauthenticated SMTP with a From address', () => {
        const unauthenticated = {...configured, EMAIL_USERNAME: '', EMAIL_PASSWORD: ''}
        expect(() => validateEmailConfiguration({...unauthenticated, EMAIL_FROM: 'passmower@example.com'}))
            .not.toThrow()
        expect(() => validateEmailConfiguration(unauthenticated)).toThrow(/EMAIL_FROM/)
        expect(() => validateEmailConfiguration({...configured, EMAIL_PASSWORD: ''}))
            .toThrow(/set together/)
        expect(() => validateEmailConfiguration({...configured, EMAIL_USERNAME: '', EMAIL_FROM: 'a@example.com'}))
            .toThrow(/set together/)
    })
})

describe('outbound email switch naming', () => {
    it('honors OUTBOUND_EMAIL_ENABLED with EMAIL_ENABLED as legacy fallback', () => {
        expect(isOutboundEmailEnabled({OUTBOUND_EMAIL_ENABLED: 'false'})).toBe(false)
        expect(isOutboundEmailEnabled({EMAIL_ENABLED: 'false'})).toBe(false)
        // the new name wins when both are set
        expect(isOutboundEmailEnabled({OUTBOUND_EMAIL_ENABLED: 'true', EMAIL_ENABLED: 'false'})).toBe(true)
        expect(isOutboundEmailEnabled({})).toBe(true)
    })
})
