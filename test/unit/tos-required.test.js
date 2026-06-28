import { describe, it, expect } from 'vitest'
import Account from '../../src/models/account.js'
import { tosRequired } from '../../src/utils/user/tos-required.js'

function account({ type, tosAccepted = false } = {}) {
    return new Account().fromKubernetes({
        metadata: { name: 'u', labels: {} },
        spec: type ? { type } : {},
        status: { conditions: tosAccepted ? [{ type: 'ToSv1', status: 'True' }] : [] },
    })
}

describe('tosRequired (#62: ToS only applies to people)', () => {
    it('requires ToS for a person who has not accepted it', () => {
        expect(tosRequired(account({ type: 'person' }))).toBe(true)
    })

    it('does not require ToS once a person has accepted it', () => {
        expect(tosRequired(account({ type: 'person', tosAccepted: true }))).toBe(false)
    })

    it('treats an account with no type as a person', () => {
        expect(tosRequired(account({}))).toBe(true)
    })

    it('skips ToS for non-person accounts regardless of acceptance', () => {
        for (const type of ['service', 'org', 'group']) {
            expect(tosRequired(account({ type }))).toBe(false)
        }
    })

    it('exposes spec.type via Account.type', () => {
        expect(account({ type: 'service' }).type).toBe('service')
        expect(account({}).type).toBeNull()
    })
})
