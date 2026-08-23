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
