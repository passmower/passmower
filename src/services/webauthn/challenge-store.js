import RedisAdapter from "../../adapters/redis.js";

const CHALLENGE_TTL = 60; // 60 seconds for WebAuthn ceremony

export class WebAuthnChallengeStore {
    constructor() {
        this.redis = new RedisAdapter('WebAuthnChallenge');
    }

    async store(key, challenge) {
        await this.redis.upsert(key, { challenge }, CHALLENGE_TTL);
    }

    async get(key) {
        const data = await this.redis.find(key);
        return data?.challenge;
    }

    async remove(key) {
        await this.redis.destroy(key);
    }
}
