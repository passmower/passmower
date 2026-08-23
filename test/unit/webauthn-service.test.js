import {beforeEach, describe, expect, it, vi} from 'vitest'

const mocks = vi.hoisted(() => ({
    generateRegistrationOptions: vi.fn(),
    generateAuthenticationOptions: vi.fn(),
    verifyRegistrationResponse: vi.fn(),
    verifyAuthenticationResponse: vi.fn(),
    store: vi.fn(),
    get: vi.fn(),
    remove: vi.fn(),
}))

vi.mock('@simplewebauthn/server', () => ({
    generateRegistrationOptions: mocks.generateRegistrationOptions,
    generateAuthenticationOptions: mocks.generateAuthenticationOptions,
    verifyRegistrationResponse: mocks.verifyRegistrationResponse,
    verifyAuthenticationResponse: mocks.verifyAuthenticationResponse,
}))

vi.mock('../../src/services/webauthn/challenge-store.js', () => ({
    WebAuthnChallengeStore: class WebAuthnChallengeStore {
        store(...args) {
            return mocks.store(...args)
        }

        get(...args) {
            return mocks.get(...args)
        }

        remove(...args) {
            return mocks.remove(...args)
        }
    },
}))

import {WebAuthnService} from '../../src/services/webauthn/webauthn-service.js'

const credential = {
    id: 'existing-credential_id',
    publicKey: 'cHVibGljLWtleQ',
    counter: 1,
    transports: ['usb'],
}

const account = {
    accountId: 'alice',
    username: 'alice',
    profile: {name: 'Alice'},
    webauthn: {credentials: [credential]},
}

describe('WebAuthnService credential IDs', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        mocks.generateRegistrationOptions.mockResolvedValue({challenge: 'registration-challenge'})
        mocks.generateAuthenticationOptions.mockResolvedValue({challenge: 'authentication-challenge'})
    })

    it('keeps existing credential IDs as base64url strings when registering another passkey', async () => {
        const service = new WebAuthnService({})

        await service.startRegistration(account)

        expect(mocks.generateRegistrationOptions).toHaveBeenCalledWith(expect.objectContaining({
            excludeCredentials: [{
                id: credential.id,
                transports: credential.transports,
            }],
        }))
        expect(mocks.store).toHaveBeenCalledWith('reg:alice', 'registration-challenge')
    })

    it('keeps credential IDs as base64url strings in known-user authentication options', async () => {
        const userService = {findUser: vi.fn().mockResolvedValue(account)}
        const service = new WebAuthnService(userService)

        await service.startAuthentication('interaction-id', account.accountId)

        expect(mocks.generateAuthenticationOptions).toHaveBeenCalledWith(expect.objectContaining({
            allowCredentials: [{
                id: credential.id,
                transports: credential.transports,
            }],
        }))
    })

    it('keeps the stored credential ID as a string during authentication verification', async () => {
        mocks.get.mockResolvedValue('authentication-challenge')
        mocks.verifyAuthenticationResponse.mockResolvedValue({verified: false})
        const userService = {findUserByPasskeyId: vi.fn().mockResolvedValue(account)}
        const service = new WebAuthnService(userService)

        await service.finishAuthentication('interaction-id', {id: credential.id})

        expect(mocks.verifyAuthenticationResponse).toHaveBeenCalledWith(expect.objectContaining({
            credential: expect.objectContaining({id: credential.id}),
        }))
    })
})
