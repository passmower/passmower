import { describe, it, expect, vi, afterEach } from 'vitest'
import Account from '../../src/models/account.js'
import { Approved } from '../../src/conditions/approved.js'

afterEach(() => vi.unstubAllEnvs())

function accountWith({ conditions = [], groups = [] } = {}) {
    return new Account().fromKubernetes({
        metadata: { name: 'u-test', labels: {} },
        status: { conditions, groups },
    })
}

describe('Approved condition', () => {
    it('approves everyone when REQUIRED_GROUP is not set', () => {
        vi.stubEnv('REQUIRED_GROUP', '')
        expect(new Approved().check(accountWith())).toBe(true)
    })

    it('requires membership of REQUIRED_GROUP when set', () => {
        vi.stubEnv('REQUIRED_GROUP', 'local:staff')
        const member = accountWith({ groups: [{ prefix: 'local', name: 'staff' }] })
        const nonMember = accountWith({ groups: [{ prefix: 'local', name: 'other' }] })
        expect(new Approved().check(member)).toBeTruthy()
        expect(new Approved().check(nonMember)).toBeFalsy()
    })
})

describe('condition shape', () => {
    it('emits plain metav1.Condition objects without apiVersion/kind', () => {
        // The CRD schema used to mark conditions as embedded resources, which
        // required apiVersion/kind inside every item and made any CR whose
        // conditions lacked them fail validation on every subsequent update.
        const condition = new Approved().toKubeCondition()
        expect(condition.type).toBe('Approved')
        expect(condition.apiVersion).toBeUndefined()
        expect(condition.kind).toBeUndefined()
    })
})
