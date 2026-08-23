import {afterEach, describe, expect, it, vi} from 'vitest';
import {SlackAdapter} from '../../src/adapters/slack.js';

const originalLogger = globalThis.logger

afterEach(() => {
    globalThis.logger = originalLogger
    vi.unstubAllEnvs()
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
