import { describe, it, expect, vi, afterEach } from 'vitest'
import Account from '../../src/models/account.js'
import { ToSv1 } from '../../src/conditions/tosv1.js'
import { Approved } from '../../src/conditions/approved.js'

afterEach(() => vi.unstubAllEnvs())

function accountWith({ conditions = [], groups = [] } = {}) {
    return new Account().fromKubernetes({
        metadata: { name: 'u-test', labels: {} },
        status: { conditions, groups },
    })
}

describe('ToSv1 condition', () => {
    it('check() is true only when a True ToSv1 condition is present', () => {
        const cond = new ToSv1()
        expect(cond.check(accountWith({ conditions: [{ type: 'ToSv1', status: 'True' }] }))).toBe(true)
        expect(cond.check(accountWith({ conditions: [{ type: 'ToSv1', status: 'False' }] }))).toBe(false)
        expect(cond.check(accountWith({ conditions: [] }))).toBeFalsy()
    })

    it('set()/add() append a True condition that check() then accepts', () => {
        const account = accountWith()
        new ToSv1().setStatus(true).set(account)
        expect(new ToSv1().check(account)).toBe(true)
    })
})

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
