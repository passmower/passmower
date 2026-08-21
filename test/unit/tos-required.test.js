import { describe, it, expect } from 'vitest'
import Account from '../../src/models/account.js'
import { tosRequired } from '../../src/utils/user/tos-required.js'

function account({ type, tosAccepted = false, legacyAccepted = false } = {}) {
    return new Account().fromKubernetes({
        metadata: { name: 'u', labels: {} },
        spec: type ? { type } : {},
        status: {
            termsOfService: tosAccepted ? {
                acceptedAt: '2026-08-06T12:00:00.000Z',
                contentHash: 'sha256',
            } : undefined,
            conditions: legacyAccepted ? [{
                type: 'ToSv1', status: 'True', lastTransitionTime: '2025-01-01T00:00:00.000Z',
            }] : [],
        },
    })
}

const document = {text: 'Terms', contentHash: 'sha256'}

describe('tosRequired (#62: ToS only applies to people)', () => {
    it('requires ToS for a person who has not accepted it', () => {
        expect(tosRequired(account({ type: 'person' }), document)).toBe(true)
    })

    it('does not require ToS once a person has accepted it', () => {
        expect(tosRequired(account({ type: 'person', tosAccepted: true }), document)).toBe(false)
    })

    it('accepts the legacy ToSv1 condition during migration', () => {
        expect(tosRequired(account({type: 'person', legacyAccepted: true}), document)).toBe(false)
    })

    it('treats an account with no type as a person', () => {
        expect(tosRequired(account({}), document)).toBe(true)
    })

    it('skips ToS for non-person accounts regardless of acceptance', () => {
        for (const type of ['service', 'org', 'group']) {
            expect(tosRequired(account({ type }), document)).toBe(false)
        }
    })

    it('skips acceptance entirely when no ToS document is configured', () => {
        expect(tosRequired(account({type: 'person'}), null)).toBe(false)
    })

    it('requires renewed acceptance when the configured document changes', () => {
        expect(tosRequired(account({type: 'person', tosAccepted: true}), {
            text: 'Updated terms', contentHash: 'updated-sha256',
        })).toBe(true)
    })

    it('exposes spec.type via Account.type', () => {
        expect(account({ type: 'service' }).type).toBe('service')
        expect(account({}).type).toBeNull()
    })
})
