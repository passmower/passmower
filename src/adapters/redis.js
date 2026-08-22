// npm i ioredis@^4.0.0
import Redis from 'ioredis'; // eslint-disable-line import/no-unresolved
import isEmpty from 'lodash/isEmpty.js';
import dns from 'node:dns/promises';

// Track connection state
let connectionErrorCount = 0;
let isReady = false;
let readyResolve;
let readyPromise = new Promise(resolve => { readyResolve = resolve; });

const MAX_ERROR_COUNT = 5;
const DNS_REFRESH_INTERVAL = 30000; // 30 seconds

export function getRedisUrl(env = process.env) {
    if (env.REDIS_URI) {
        return env.REDIS_URI;
    }
    if (!env.REDIS_HOST) {
        return undefined;
    }

    const host = env.REDIS_HOST.trim();
    const formattedHost = host.includes(':') && !host.startsWith('[') ? `[${host}]` : host;
    const url = new URL(`redis://${formattedHost}`);
    const port = env.REDIS_PORT || '6379';
    const database = env.REDIS_DB || '0';

    if (!/^\d+$/.test(port) || Number(port) < 1 || Number(port) > 65535) {
        throw new Error('REDIS_PORT must be an integer between 1 and 65535');
    }
    if (!/^\d+$/.test(database)) {
        throw new Error('REDIS_DB must be a non-negative integer');
    }

    url.port = port;
    url.pathname = `/${database}`;
    if (env.REDIS_USERNAME) {
        url.username = env.REDIS_USERNAME;
    }
    if (env.REDIS_PASSWORD) {
        url.password = env.REDIS_PASSWORD;
    }
    return url.href;
}

// Resolve a host to its current set of IPs, honoring REDIS_IP_FAMILY
// (0 = both, 4 = IPv4 only, 6 = IPv6 only) so the DNS-change watcher resolves
// the same address family the connection itself uses. dns.resolve() only
// queries A (IPv4) records, so on an IPv6-only Service it threw ENODATA on
// every check — spamming errors and preventing the change-triggered reconnect
// from ever running. dns.lookup() respects the family hint (and getaddrinfo).
export async function resolveHostIps(host, family = parseInt(process.env.REDIS_IP_FAMILY ?? '0')) {
    const records = await dns.lookup(host, { all: true, family });
    return records.map(record => record.address).sort();
}

// The single shared client and the timers that keep it healthy. These are
// created lazily by connect() rather than at import time so that importing a
// module that transitively pulls in this adapter does NOT open a Redis
// connection or pin the event loop (important for tests and tooling).
let client;
let timers = [];

export function getRedisOptions(isInitial = false, env = process.env) {
    return {
        keyPrefix: 'oidc:',
        family: parseInt(env.REDIS_IP_FAMILY ?? '0'),
        protocol: 3,
        // Only enable offline queue for initial connection, disable after ready
        enableOfflineQueue: isInitial,
        // Shorter timeouts for faster failover detection
        connectTimeout: 10000,
        // Reconnect on READONLY errors (replica promoted to master scenario)
        reconnectOnError(err) {
            const targetErrors = ['READONLY', 'MOVED', 'ASK', 'CLUSTERDOWN'];
            if (targetErrors.some(e => err.message?.includes(e))) {
                globalThis.logger?.warn(`Redis: Reconnecting due to ${err.message}`)
                connectionErrorCount++;
                return true;
            }
            return false;
        },
    };
}

function createRedisClient(redisUrl, isInitial = false) {
    const newClient = new Redis(redisUrl, getRedisOptions(isInitial));

    newClient.on('error', (err) => {
        globalThis.logger?.error({ err }, 'Redis connection error')
        connectionErrorCount++;
        isReady = false;
    });

    newClient.on('connect', () => {
        globalThis.logger?.info('Redis connected')
        connectionErrorCount = 0;
    });

    newClient.on('ready', () => {
        globalThis.logger?.info('Redis ready')
        connectionErrorCount = 0;
        isReady = true;
        // Disable offline queue after initial connection is ready
        newClient.options.enableOfflineQueue = false;
        readyResolve();
    });

    newClient.on('close', () => {
        isReady = false;
    });

    return newClient;
}

// Open the connection and start the health timers. Idempotent: safe to call
// more than once. Called lazily on first use (getClient/waitForReady) and
// explicitly at app boot via waitForReady().
export function connect() {
    if (client) {
        return client;
    }

    const redisUrl = getRedisUrl();
    if (!redisUrl) {
        throw new Error('Redis is not configured: set REDIS_URI or REDIS_HOST');
    }
    const redisHost = new URL(redisUrl).hostname;
    const isHeadlessService = redisHost.endsWith('.svc.cluster.local') || redisHost.endsWith('.svc');

    client = createRedisClient(redisUrl, true);

    // For headless services: periodically check if DNS has changed and reconnect if needed
    if (isHeadlessService) {
        let lastKnownIps = [];

        const checkDnsAndReconnect = async () => {
            try {
                const currentIps = await resolveHostIps(redisHost);

                if (lastKnownIps.length > 0 && JSON.stringify(lastKnownIps) !== JSON.stringify(currentIps)) {
                    globalThis.logger?.warn({ oldIps: lastKnownIps, newIps: currentIps }, 'Redis: DNS changed, reconnecting...')
                    client.disconnect();
                    client = createRedisClient(redisUrl, false);
                }
                lastKnownIps = currentIps;
            } catch (err) {
                globalThis.logger?.error({ err }, 'Redis: DNS lookup failed')
            }
        };

        // Initial DNS lookup
        checkDnsAndReconnect();
        // Periodic DNS check
        timers.push(setInterval(checkDnsAndReconnect, DNS_REFRESH_INTERVAL).unref());
    }

    // Force reconnect if too many errors accumulate
    timers.push(setInterval(() => {
        if (connectionErrorCount >= MAX_ERROR_COUNT) {
            globalThis.logger?.warn(`Redis: ${connectionErrorCount} errors accumulated, forcing reconnect...`)
            connectionErrorCount = 0;
            client.disconnect();
            client = createRedisClient(redisUrl, false);
        }
    }, 10000).unref());

    return client;
}

// Tear down the connection and timers (for test teardown / graceful shutdown).
export async function disconnect() {
    timers.forEach(clearInterval);
    timers = [];
    if (client) {
        const c = client;
        client = undefined;
        // Let scheduled async work (e.g. fire-and-forget event listeners that
        // do Redis I/O) run, then wait for the command queue to be *stably*
        // empty before closing — otherwise ioredis rejects still-queued (or
        // about-to-be-issued) commands with "Connection is closed" as an
        // unhandled rejection. The stability check covers the gaps between a
        // listener's sequential awaited commands.
        const deadline = Date.now() + 2000;
        await new Promise(resolve => setTimeout(resolve, 100));
        let emptyStreak = 0;
        while (emptyStreak < 3 && Date.now() < deadline) {
            emptyStreak = c.commandQueue?.length ? 0 : emptyStreak + 1;
            await new Promise(resolve => setTimeout(resolve, 25));
        }
        await c.quit().catch(() => c.disconnect());
    }
    isReady = false;
    readyPromise = new Promise(resolve => { readyResolve = resolve; });
}

// Export a getter to always use the current client instance. Connects on first use.
const getClient = () => client ?? connect();

// Wait for initial connection to be ready (connecting if necessary).
export const waitForReady = () => {
    connect();
    return readyPromise;
};

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

// Read the raw values of every key matching `pattern` (full key names,
// including the "oidc:" prefix). SCAN's MATCH argument is not affected by the
// ioredis keyPrefix, but MGET arguments are, so the prefix is stripped before
// reading.
export async function scanKeyValues(pattern, {batch = 500} = {}) {
    const c = getClient();
    const keys = [];
    let cursor = '0';
    do {
        const [next, found] = await c.scan(cursor, 'MATCH', pattern, 'COUNT', batch);
        cursor = next;
        keys.push(...found);
    } while (cursor !== '0');
    if (!keys.length) return [];
    const prefix = getRedisOptions().keyPrefix;
    return await c.mget(keys.map(key => key.startsWith(prefix) ? key.slice(prefix.length) : key));
}

class RedisAdapter {
    constructor(name) {
        this.name = name;
    }

    async upsert(id, payload, expiresIn) {
        const key = this.key(id);
        const store = consumable.has(this.name)
            ? { payload: JSON.stringify(payload) } : JSON.stringify(payload);

        const multi = getClient().multi();
        multi[consumable.has(this.name) ? 'hmset' : 'set'](key, store);

        if (expiresIn) {
            multi.expire(key, expiresIn);
        }

        if (grantable.has(this.name) && payload.grantId) {
            const grantKey = grantKeyFor(payload.grantId);
            multi.rpush(grantKey, key);
            // if you're seeing grant key lists growing out of acceptable proportions consider using LTRIM
            // here to trim the list to an appropriate length
            const ttl = await getClient().ttl(grantKey);
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
            await getClient().sadd(key, id);
            if (payload[referencable[this.name]?.expireKey]) {
                const ttl = Math.floor(payload[referencable[this.name]?.expireKey] - Date.now() / 1000)
                await getClient().expire(key, ttl)
            }
        }
    }

    async appendToSet(id, item) {
        await getClient().sadd(this.key(id), item);
    }

    async removeFromSet(id, item) {
        await getClient().srem(this.key(id), item);
    }

    async getSetMembers(id) {
        return await getClient().smembers(this.key(id))
    }

    async find(id) {
        const data = consumable.has(this.name)
            ? await getClient().hgetall(this.key(id))
            : await getClient().get(this.key(id));

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
        const id = await getClient().get(uidKeyFor(uid));
        return this.find(id);
    }

    async findByUserCode(userCode) {
        const id = await getClient().get(userCodeKeyFor(userCode));
        return this.find(id);
    }

    async destroy(id) {
        const key = this.key(id);
        const payload = await this.find(id)

        await getClient().del(key);

        if (referencable[this.name]) {
            const owner = payload?.[referencable[this.name]?.ownerKey] ?? 1
            const key = `${referencable[this.name].listName}:${owner}`;
            await getClient().srem(key, id);
        }
    }

    async revokeByGrantId(grantId) { // eslint-disable-line class-methods-use-this
        const multi = getClient().multi();
        const tokens = await getClient().lrange(grantKeyFor(grantId), 0, -1);
        tokens.forEach((token) => multi.del(token));
        multi.del(grantKeyFor(grantId));
        await multi.exec();
    }

    async consume(id) {
        await getClient().hset(this.key(id), 'consumed', Math.floor(Date.now() / 1000));
    }

    key(id) {
        return `${this.name}:${id}`;
    }
}

export default RedisAdapter;
