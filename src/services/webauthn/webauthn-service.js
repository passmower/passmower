import {
    generateRegistrationOptions,
    verifyRegistrationResponse,
    generateAuthenticationOptions,
    verifyAuthenticationResponse,
} from '@simplewebauthn/server';
import { WebAuthnChallengeStore } from './challenge-store.js';

// Helper functions for base64url encoding/decoding
function bufferToBase64URL(buffer) {
    return Buffer.from(buffer).toString('base64url');
}

function base64URLToBuffer(base64url) {
    return Buffer.from(base64url, 'base64url');
}

export class WebAuthnService {
    constructor(kubeOIDCUserService) {
        this.userService = kubeOIDCUserService;
        this.challengeStore = new WebAuthnChallengeStore();

        // Relying Party configuration from environment
        const issuerUrl = new URL(process.env.ISSUER_URL);
        this.rpID = issuerUrl.hostname;
        this.rpName = process.env.WEBAUTHN_RP_NAME || 'Passmower';
        // Origin must NOT have a trailing slash
        this.origin = issuerUrl.origin;
    }

    /**
     * Start passkey registration for an authenticated user
     * @param {Account} account - The authenticated user's account
     * @returns {Promise<PublicKeyCredentialCreationOptionsJSON>}
     */
    async startRegistration(account) {
        const existingCredentials = account.webauthn?.credentials || [];

        const options = await generateRegistrationOptions({
            rpName: this.rpName,
            rpID: this.rpID,
            userID: new TextEncoder().encode(account.accountId),
            userName: account.username || account.accountId,
            userDisplayName: account.profile?.name || account.username || account.accountId,
            // Prevent re-registration of existing credentials
            excludeCredentials: existingCredentials.map(cred => ({
                id: base64URLToBuffer(cred.id),
                transports: cred.transports,
            })),
            authenticatorSelection: {
                // Prefer resident keys (discoverable credentials) for passwordless login
                residentKey: 'preferred',
                userVerification: 'preferred',
            },
            // Support common algorithms
            supportedAlgorithmIDs: [-7, -257], // ES256, RS256
        });

        // Store challenge temporarily in Redis
        await this.challengeStore.store(`reg:${account.accountId}`, options.challenge);

        return options;
    }

    /**
     * Complete passkey registration
     * @param {Account} account - The authenticated user's account
     * @param {RegistrationResponseJSON} response - The authenticator's response
     * @param {string} name - User-friendly name for the credential
     * @returns {Promise<{verified: boolean, credential?: object}>}
     */
    async finishRegistration(account, response, name = 'Passkey') {
        const expectedChallenge = await this.challengeStore.get(`reg:${account.accountId}`);

        if (!expectedChallenge) {
            throw new Error('Registration challenge expired or not found');
        }

        try {
            const verification = await verifyRegistrationResponse({
                response,
                expectedChallenge,
                expectedOrigin: this.origin,
                expectedRPID: this.rpID,
            });

            if (verification.verified && verification.registrationInfo) {
                const { credential, credentialDeviceType, credentialBackedUp } = verification.registrationInfo;

                // Use the credential ID from the original response (already base64url)
                // This ensures consistency with what the browser sends during authentication
                const newCredential = {
                    id: response.id,
                    publicKey: bufferToBase64URL(credential.publicKey),
                    counter: credential.counter,
                    transports: response.response.transports || [],
                    createdAt: new Date().toISOString(),
                    name: name,
                    deviceType: credentialDeviceType,
                    backedUp: credentialBackedUp,
                };

                // Store credential in OIDCUser CRD
                await this.userService.addPasskey(account.accountId, newCredential);

                // Clean up challenge
                await this.challengeStore.remove(`reg:${account.accountId}`);

                return { verified: true, credential: newCredential };
            }

            return { verified: false };
        } catch (error) {
            globalThis.logger?.error({ error }, 'WebAuthn registration verification failed');
            throw error;
        }
    }

    /**
     * Start passkey authentication (login)
     * @param {string} sessionId - Session/interaction ID for challenge storage
     * @param {string} [accountId] - Optional account ID if known (for non-discoverable flow)
     * @returns {Promise<PublicKeyCredentialRequestOptionsJSON>}
     */
    async startAuthentication(sessionId, accountId = null) {
        let allowCredentials;

        if (accountId) {
            // If we know the user, only allow their credentials
            const account = await this.userService.findUser(accountId);
            if (account?.webauthn?.credentials?.length) {
                allowCredentials = account.webauthn.credentials.map(cred => ({
                    id: base64URLToBuffer(cred.id),
                    transports: cred.transports,
                }));
            }
        }
        // If no accountId or no credentials, allowCredentials is undefined
        // This enables the discoverable credential (resident key) flow

        const options = await generateAuthenticationOptions({
            rpID: this.rpID,
            allowCredentials,
            userVerification: 'preferred',
        });

        // Store challenge with session ID
        await this.challengeStore.store(`auth:${sessionId}`, options.challenge);

        return options;
    }

    /**
     * Complete passkey authentication
     * @param {string} sessionId - Session/interaction ID
     * @param {AuthenticationResponseJSON} response - The authenticator's response
     * @returns {Promise<{verified: boolean, account?: Account}>}
     */
    async finishAuthentication(sessionId, response) {
        const expectedChallenge = await this.challengeStore.get(`auth:${sessionId}`);

        if (!expectedChallenge) {
            throw new Error('Authentication challenge expired or not found');
        }

        // Find user by credential ID
        // response.id from the browser is already base64url encoded
        const credentialId = response.id;
        globalThis.logger?.info({ credentialId, rawId: response.rawId }, 'Looking up credential');

        const account = await this.userService.findUserByPasskeyId(credentialId);

        if (!account) {
            globalThis.logger?.info({ searchedId: credentialId }, 'Credential not found');
            throw new Error('Unknown credential');
        }

        const credential = account.webauthn.credentials.find(c => c.id === credentialId);

        if (!credential) {
            throw new Error('Credential not found in user account');
        }

        try {
            const verification = await verifyAuthenticationResponse({
                response,
                expectedChallenge,
                expectedOrigin: this.origin,
                expectedRPID: this.rpID,
                credential: {
                    id: base64URLToBuffer(credential.id),
                    publicKey: base64URLToBuffer(credential.publicKey),
                    counter: credential.counter,
                    transports: credential.transports,
                },
            });

            if (verification.verified) {
                // Update counter to prevent replay attacks
                await this.userService.updatePasskeyCounter(
                    account.accountId,
                    credential.id,
                    verification.authenticationInfo.newCounter
                );

                // Clean up challenge
                await this.challengeStore.remove(`auth:${sessionId}`);

                return { verified: true, account };
            }

            return { verified: false };
        } catch (error) {
            globalThis.logger?.error({ error }, 'WebAuthn authentication verification failed');
            throw error;
        }
    }

    /**
     * List passkeys for an account (without sensitive data)
     * @param {Account} account
     * @returns {Array<{id: string, name: string, createdAt: string, transports: string[]}>}
     */
    listPasskeys(account) {
        const credentials = account.webauthn?.credentials || [];
        return credentials.map(cred => ({
            id: cred.id,
            name: cred.name,
            createdAt: cred.createdAt,
            transports: cred.transports,
            deviceType: cred.deviceType,
            backedUp: cred.backedUp,
        }));
    }

    /**
     * Remove a passkey from an account
     * @param {string} accountId
     * @param {string} credentialId
     * @returns {Promise<void>}
     */
    async removePasskey(accountId, credentialId) {
        await this.userService.removePasskey(accountId, credentialId);
    }

    /**
     * Rename a passkey
     * @param {string} accountId
     * @param {string} credentialId
     * @param {string} newName
     * @returns {Promise<void>}
     */
    async renamePasskey(accountId, credentialId, newName) {
        await this.userService.renamePasskey(accountId, credentialId, newName);
    }
}

export default WebAuthnService;
