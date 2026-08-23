import {describe, expect, it} from 'vitest'
import {interactionLogFields} from '../../src/providers/setup-event-listeners.js'

describe('OIDC interaction logging', () => {
    it('logs identifiers without serializing upstream OAuth credentials', () => {
        const fields = interactionLogFields({
            jti: 'interaction-1',
            kind: 'Interaction',
            params: {client_id: 'dashboard'},
            prompt: {name: 'login'},
            session: {accountId: 'alice', cookie: 'session-secret'},
            result: {oauth: {provider: 'GitHub', token: 'oauth-secret'}},
        })

        expect(fields).toEqual({
            interactionId: 'interaction-1',
            kind: 'Interaction',
            clientId: 'dashboard',
            prompt: 'login',
            accountId: 'alice',
        })
        expect(JSON.stringify(fields)).not.toContain('secret')
    })
})
