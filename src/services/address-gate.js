import RedisAdapter from "../adapters/redis.js";
import {asnOf, countryOf, getGeoipAsnReader, getGeoipReader} from "../utils/geoip.js";
import {addressKey, inRanges, parseRanges} from "../utils/ip-address.js";

// Address gate (#342): one allowlist of client addresses for every application
// behind the gate's forwardAuth middleware. An address passes when it is in a
// configured range, in an allowed country, announced by an allowed autonomous
// system (ISP), or unlocked by someone currently signed in to Passmower from it.

export const addressGateEnabled = (env = process.env) => env.ADDRESS_GATE_ENABLED === 'true'

export const sessionUnlockEnabled = (env = process.env) => env.ADDRESS_GATE_SESSION_UNLOCK !== 'false'

const list = (value) => (value ?? '').split(/[\s,]+/).filter(Boolean)

export const gateCountries = (env = process.env) =>
    list(env.ADDRESS_GATE_ALLOWED_COUNTRIES).map(c => c.toUpperCase())

// Accepts 3249 and AS3249 alike.
export const gateAsns = (env = process.env) => list(env.ADDRESS_GATE_ALLOWED_ASNS).map((value) => {
    const number = Number(value.replace(/^AS/i, ''))
    if (!Number.isInteger(number) || number <= 0) throw new Error(`Invalid ASN "${value}" in ADDRESS_GATE_ALLOWED_ASNS`)
    return number
})

// Parsed once per distinct value: the gate runs on every gated request.
let cachedRanges
export const gateRanges = (env = process.env) => {
    const value = env.ADDRESS_GATE_ALLOWED_RANGES ?? ''
    if (cachedRanges?.value !== value) cachedRanges = {value, ranges: parseRanges(value)}
    return cachedRanges.ranges
}

// Fails boot on a configuration the gate cannot apply: a malformed range or
// ASN, or a country or ASN rule without the database to evaluate it.
export const validateAddressGateConfiguration = async (env = process.env) => {
    if (!addressGateEnabled(env)) return
    gateRanges(env)
    if (gateCountries(env).length && !await getGeoipReader(env)) {
        throw new Error('ADDRESS_GATE_ALLOWED_COUNTRIES needs a GeoIP country database (GEOIP_DATABASE_PATH)')
    }
    if (gateAsns(env).length && !await getGeoipAsnReader(env)) {
        throw new Error('ADDRESS_GATE_ALLOWED_ASNS needs a GeoIP ASN database (GEOIP_ASN_DATABASE_PATH)')
    }
}

const now = () => Math.floor(Date.now() / 1000)
const unlocks = () => new RedisAdapter('GateAddress')

// Records that the signed-in session behind this request vouches for its
// address until the session expires. Several sessions can share an address
// (a household, an office NAT); each is kept until its own expiry.
//
// `already` reports that this session had unlocked the address before. The
// gate only sends a browser here when it refused it, so a repeat means the
// application sees the browser at another address than Passmower does.
export const unlockAddress = async (ip, session, defaultTtl) => {
    const key = addressKey(ip)
    if (!key || !session?.uid) return {}
    const until = session.exp ?? now() + defaultTtl
    // Atomic: two people behind one address can unlock it at the same moment.
    const already = await unlocks().setExpiringField(key, session.uid, until)
    return {key, already}
}

// True while at least one session that unlocked this address is still alive.
// The session is looked up, not just its recorded expiry, so signing out (or a
// geo-lock denial) closes the address again straight away.
export const sessionUnlocked = async (ip, findSessionByUid) => {
    const key = addressKey(ip)
    const sessions = key ? await unlocks().getFields(key) : undefined
    for (const [uid, exp] of Object.entries(sessions ?? {})) {
        if (Number(exp) <= now()) continue
        const session = await findSessionByUid(uid)
        if (session?.accountId) return true
    }
    return false
}

// The first rule that lets the address through, cheapest first: the static
// rules are in memory, only a session unlock touches Redis.
export const gateDecision = async (ip, {findSessionByUid, env = process.env}) => {
    if (inRanges(gateRanges(env), ip)) return {allowed: true, rule: 'range'}
    const countries = gateCountries(env)
    const country = countries.length ? await countryOf(ip, env) : undefined
    if (country && countries.includes(country)) return {allowed: true, rule: 'country'}
    const asns = gateAsns(env)
    const asn = asns.length ? await asnOf(ip, env) : undefined
    if (asn && asns.includes(asn.number)) return {allowed: true, rule: 'asn'}
    if (sessionUnlockEnabled(env) && await sessionUnlocked(ip, findSessionByUid)) {
        return {allowed: true, rule: 'session'}
    }
    return {allowed: false, rule: 'none', country, asn: asn?.number}
}
