import RedisAdapter from "../../adapters/redis.js";
import {countryOf, geoLockEnabled, geoLockFailure} from "../geoip.js";
import {requestIp} from "./parse-request-headers.js";
import {auditLog} from "./audit-log.js";
import {recordIncident} from "./incident-log.js";
import {AuditService} from "../../services/audit-service.js";

// Geo-lock (#315): a session is pinned to the country it authenticated from,
// and requests from any other country (outside GEO_LOCK_ALLOWED_COUNTRIES) are
// refused. Pins are keyed by the OIDC session uid, which survives the session
// id rotation on every resume.
const pins = () => new RedisAdapter('SessionGeo')

// A pin past its exp is treated as gone even before Redis evicts it, the same
// way oidc-provider treats a session past its exp.
export const findSessionPin = async (sessionUid) => {
    const pin = sessionUid ? await pins().find(sessionUid) : undefined
    if (pin?.exp && pin.exp <= Math.floor(Date.now() / 1000)) return undefined
    return pin
}

// A fresh authentication always (re)pins: that is how a traveller recovers.
// SSO into another application keeps the existing pin.
export const pinSession = async (ctx, session, {fresh, defaultTtl}) => {
    if (!geoLockEnabled() || !session?.uid) return
    if (!fresh && await findSessionPin(session.uid)) return
    const ip = requestIp(ctx)
    const country = await countryOf(ip)
    if (!country) return
    const now = Math.floor(Date.now() / 1000)
    await pins().upsert(session.uid, {country, ip, ts: now, exp: session.exp}, session.exp ? session.exp - now : defaultTtl)
}

// Sessions slide: every save moves exp forward. The pin follows, or it would
// expire under a live session and lock its owner out. Called from the
// session.saved event, after oidc-provider has persisted the renewed exp; a
// request middleware only ever sees the exp from before the renewal.
export const extendSessionPin = async (session) => {
    if (!geoLockEnabled() || !session?.uid || !session.exp) return
    const pin = await findSessionPin(session.uid)
    if (!pin || (pin.exp && pin.exp >= session.exp)) return
    const now = Math.floor(Date.now() / 1000)
    await pins().upsert(session.uid, {...pin, exp: session.exp}, session.exp - now)
}

// Checks the requesting address against a pinned country. Returns the failure
// code after logging it, or null when the request may proceed (and always when
// geo-lock is off).
export const enforceGeoLock = async (ctx, {source, pinnedCountry, accountId, clientId}) => {
    if (!geoLockEnabled()) return null
    const country = await countryOf(requestIp(ctx))
    const failure = geoLockFailure(pinnedCountry, country)
    if (!failure) return null
    auditLog(ctx, {accountId, clientId, failure, source, pinnedCountry, country},
        'Session rejected by geo-lock: request country differs from the session country')
    new AuditService().write({
        event: 'session.geo.denied',
        result: 'failure',
        reason: failure,
        source,
        subject: {id: accountId},
        client: clientId ? {id: clientId} : undefined,
        geo: {pinnedCountry, country},
    }, ctx)
    globalThis.metrics?.geoLockDenied?.inc({source, reason: failure})
    await recordIncident(ctx, {source: `geo-lock:${source}`, accountId, clientId, failure: `${failure}:${country}`})
    return failure
}
