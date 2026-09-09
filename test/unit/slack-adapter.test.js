import {afterEach, describe, expect, it, vi} from 'vitest';
import {SlackAdapter} from '../../src/adapters/slack.js';

const originalLogger = globalThis.logger

afterEach(() => {
    globalThis.logger = originalLogger
    vi.unstubAllEnvs()
})

describe('SlackAdapter.sendMessage', () => {
    const adapterWithSpy = () => {
        const adapter = new SlackAdapter()
        adapter.client = {chat: {postMessage: vi.fn().mockResolvedValue({ok: true})}}
        return adapter
    }

    it('omits blocks entirely when a caller has none, keeping the old payload', async () => {
        const adapter = adapterWithSpy()

        await adapter.sendMessage('U1', 'plain notice')

        expect(adapter.client.chat.postMessage).toHaveBeenCalledWith({
            channel: 'U1', text: 'plain notice',
        })
    })

    it('sends blocks alongside the text fallback when given', async () => {
        const adapter = adapterWithSpy()
        const blocks = [{type: 'section', text: {type: 'mrkdwn', text: 'hi'}}]

        await adapter.sendMessage('U1', 'fallback', blocks)

        expect(adapter.client.chat.postMessage).toHaveBeenCalledWith({
            channel: 'U1', text: 'fallback', blocks,
        })
    })

    it('treats an empty block list as no blocks', async () => {
        const adapter = adapterWithSpy()

        await adapter.sendMessage('U1', 'fallback', [])

        expect(adapter.client.chat.postMessage).toHaveBeenCalledWith({
            channel: 'U1', text: 'fallback',
        })
    })
})

describe('SlackAdapter.getTeamId', () => {
    it('retries workspace discovery after a transient failure without requiring a logger', async () => {
        vi.stubEnv('SLACK_TEAM_ID', '')
        globalThis.logger = undefined
        const adapter = new SlackAdapter()
        adapter.client = {
            auth: {
                test: vi.fn()
                    .mockRejectedValueOnce(new Error('temporary Slack outage'))
                    .mockResolvedValueOnce({team_id: 'T123'}),
            },
        }

        await expect(adapter.getTeamId()).resolves.toBeUndefined()
        await expect(adapter.getTeamId()).resolves.toBe('T123')
        expect(adapter.client.auth.test).toHaveBeenCalledTimes(2)
    })
})
