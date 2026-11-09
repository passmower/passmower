import {beforeEach, describe, expect, it, vi} from 'vitest'

const store = vi.hoisted(() => new Map())

vi.mock('../../src/adapters/redis.js', () => ({
    default: class RedisAdapter {
        constructor(name) {
            this.name = name
        }
        async find(id) {
            return store.get(`${this.name}:${id}`)
        }
        async upsert(id, payload, ttl) {
            store.set(`${this.name}:${id}`, {...payload, ttl})
        }
    },
}))

import {adminRequestNotificationsEnabled, notifyAdminsOfRequest} from '../../src/services/notification-service.js'

const env = {NOTIFY_ADMINS_ON_REQUESTS: 'true', SLACK_TOKEN: 'token', ISSUER_URL: 'https://auth.example.com/'}
const users = [
    {accountId: 'root', isAdmin: true, primaryEmail: 'root@example.com', slackId: 'UROOT'},
    {accountId: 'ops', isAdmin: true, primaryEmail: 'ops@example.com'},
    {accountId: 'left', isAdmin: true, disabled: true, primaryEmail: 'left@example.com', slackId: 'ULEFT'},
    {accountId: 'alice', isAdmin: false, primaryEmail: 'alice@example.com', slackId: 'UALICE'},
]

// Administrator notices for approval and access requests (#17).
describe('administrator request notifications', () => {
    let emailAdapter, slackAdapter
    const notify = (overrides = {}) => notifyAdminsOfRequest({
        key: 'approval:alice',
        summary: 'alice is waiting for approval',
        detail: 'Alice <Example>, alice@example.com',
        listUsers: async () => users,
        env, emailAdapter, slackAdapter,
        ...overrides,
    })

    beforeEach(() => {
        store.clear()
        globalThis.logger = {info: vi.fn(), warn: vi.fn(), error: vi.fn()}
        emailAdapter = {sendMail: vi.fn().mockResolvedValue({})}
        slackAdapter = {sendMessage: vi.fn().mockResolvedValue({})}
    })

    it('is off unless enabled', async () => {
        expect(adminRequestNotificationsEnabled({})).toBe(false)
        await notify({env: {...env, NOTIFY_ADMINS_ON_REQUESTS: undefined}})
        expect(emailAdapter.sendMail).not.toHaveBeenCalled()
        expect(slackAdapter.sendMessage).not.toHaveBeenCalled()
    })

    it('reaches every active administrator on the channels they have, and nobody else', async () => {
        await notify()

        expect(emailAdapter.sendMail.mock.calls.map(([to]) => to).sort()).toEqual(['ops@example.com', 'root@example.com'])
        expect(emailAdapter.sendMail.mock.calls[0][1]).toBe('alice is waiting for approval')
        expect(emailAdapter.sendMail.mock.calls[0][2]).toContain('https://auth.example.com/admin')
        expect(slackAdapter.sendMessage).toHaveBeenCalledTimes(1)
        expect(slackAdapter.sendMessage.mock.calls[0][0]).toBe('UROOT')
    })

    it('sends Slack a link button to the admin panel, never an action', async () => {
        await notify()

        const [, text, blocks] = slackAdapter.sendMessage.mock.calls[0]
        expect(text).toContain('alice is waiting for approval')
        const button = blocks.find(block => block.type === 'actions').elements[0]
        expect(button.url).toBe('https://auth.example.com/admin')
        expect(button).not.toHaveProperty('action_id')
        // Profile data is escaped for Slack mrkdwn.
        expect(blocks[0].text.text).toContain('Alice &lt;Example&gt;')
    })

    it('announces a waiting request once a day, however often it is retried', async () => {
        await notify()
        await notify()
        await notify({key: 'access:alice:grafana', summary: 'alice requested access to Grafana'})

        expect(slackAdapter.sendMessage).toHaveBeenCalledTimes(2)
        expect(store.get('AdminNotice:approval:alice').ttl).toBe(24 * 3600)
    })

    it('never fails the flow that triggered it', async () => {
        await expect(notify({listUsers: async () => { throw new Error('kube down') }})).resolves.toBeUndefined()
        emailAdapter.sendMail.mockRejectedValue(new Error('smtp down'))
        await expect(notify({key: 'other'})).resolves.toBeUndefined()
    })
})
