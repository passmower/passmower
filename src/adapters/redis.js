// npm i ioredis@^4.0.0
import Redis from 'ioredis'; // eslint-disable-line import/no-unresolved
import isEmpty from 'lodash/isEmpty.js';

const client = new Redis(process.env.REDIS_URI, {
    keyPrefix: 'oidc:',
    reconnectOnError(err) {
        globalThis.logger.error(err)
        return true
    },
});

const grantable = new Set([
    'AccessToken',
    'AuthorizationCode',
    'RefreshToken',
    'DeviceCode',
    'BackchannelAuthenticationRequest',
]);

const consumable = new Set([
    'AuthorizationCode',
    'RefreshToken',
    'DeviceCode',
    'BackchannelAuthenticationRequest',
]);

const referencable = {
    Session: {
        listName: 'AccountSession',
        ownerKey: 'accountId'
    },
    SiteSession: {
        listName: 'AccountSiteSession',
        ownerKey: 'accountId'
    },
    Client: {
        listName: 'Clients'
    },
    SessionMetadata: {
        listName: 'UidSessions',
        ownerKey: 'userId',
        expireKey: 'exp'
    },
}


function grantKeyFor(id) {
    return `grant:${id}`;
}

function userCodeKeyFor(userCode) {
    return `userCode:${userCode}`;
}

function uidKeyFor(uid) {
    return `uid:${uid}`;
}

class RedisAdapter {
    constructor(name) {
        this.name = name;
    }

    async upsert(id, payload, expiresIn) {
        const key = this.key(id);
        const store = consumable.has(this.name)
            ? { payload: JSON.stringify(payload) } : JSON.stringify(payload);

        const multi = client.multi();
        multi[consumable.has(this.name) ? 'hmset' : 'set'](key, store);

        if (expiresIn) {
            multi.expire(key, expiresIn);
        }

        if (grantable.has(this.name) && payload.grantId) {
            const grantKey = grantKeyFor(payload.grantId);
            multi.rpush(grantKey, key);
            // if you're seeing grant key lists growing out of acceptable proportions consider using LTRIM
            // here to trim the list to an appropriate length
            const ttl = await client.ttl(grantKey);
            if (expiresIn > ttl) {
                multi.expire(grantKey, expiresIn);
            }
        }

        if (payload.userCode) {
            const userCodeKey = userCodeKeyFor(payload.userCode);
            multi.set(userCodeKey, id);
            multi.expire(userCodeKey, expiresIn);
        }

        if (payload.uid) {
            const uidKey = uidKeyFor(payload.uid);
            multi.set(uidKey, id);
            multi.expire(uidKey, expiresIn);
        }

        await multi.exec();

        if (referencable[this.name]) {
            const owner = payload[referencable[this.name]?.ownerKey] ?? 1
            const key = `${referencable[this.name].listName}:${owner}`;
            await client.sadd(key, id);
            if (payload[referencable[this.name]?.expireKey]) {
                const ttl = Math.floor(payload[referencable[this.name]?.expireKey] - Date.now() / 1000)
                await client.expire(key, ttl)
            }
        }
    }

    async appendToSet(id, item) {
        await client.sadd(this.key(id), item);
    }

    async removeFromSet(id, item) {
        await client.srem(this.key(id), item);
    }

    async getSetMembers(id) {
        return await client.smembers(this.key(id))
    }

    async find(id) {
        const data = consumable.has(this.name)
            ? await client.hgetall(this.key(id))
            : await client.get(this.key(id));

        if (isEmpty(data)) {
            return undefined;
        }

        if (typeof data === 'string') {
            return JSON.parse(data);
        }
        const { payload, ...rest } = data;
        return {
            ...rest,
            ...JSON.parse(payload),
        };
    }

    async findByUid(uid) {
        const id = await client.get(uidKeyFor(uid));
        return this.find(id);
    }

    async findByUserCode(userCode) {
        const id = await client.get(userCodeKeyFor(userCode));
        return this.find(id);
    }

    async destroy(id) {
        const key = this.key(id);
        const payload = this.find(id)

        await client.del(key);

        if (referencable[this.name]) {
            const owner = payload[referencable[this.name]?.ownerKey] ?? 1
            const key = `${referencable[this.name].listName}:${owner}`;
            await client.srem(key, id);
        }
    }

    async revokeByGrantId(grantId) { // eslint-disable-line class-methods-use-this
        const multi = client.multi();
        const tokens = await client.lrange(grantKeyFor(grantId), 0, -1);
        tokens.forEach((token) => multi.del(token));
        multi.del(grantKeyFor(grantId));
        await multi.exec();
    }

    async consume(id) {
        await client.hset(this.key(id), 'consumed', Math.floor(Date.now() / 1000));
    }

    key(id) {
        return `${this.name}:${id}`;
    }
}

export default RedisAdapter;
