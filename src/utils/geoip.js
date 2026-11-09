import maxmind from "maxmind";
import {existsSync} from "node:fs";

export const DEFAULT_GEOIP_DATABASE_PATH = '/var/lib/passmower/geoip/dbip-country-lite.mmdb'

// ISO 3166 user-assigned code for an address the database cannot place:
// private, loopback and unallocated ranges. Two such addresses compare equal,
// and an installation can list it in GEO_LOCK_ALLOWED_COUNTRIES.
export const UNKNOWN_COUNTRY = 'ZZ'

export const GEO_LOCK_UNPINNED = 'geo_lock_unpinned'
export const GEO_LOCK_COUNTRY = 'geo_lock_country'

export const geoLockEnabled = (env = process.env) => env.GEO_LOCK_ENABLED === 'true'

export const geoipDatabasePath = (env = process.env) =>
    env.GEOIP_DATABASE_PATH || DEFAULT_GEOIP_DATABASE_PATH

export const allowedCountries = (env = process.env) =>
    (env.GEO_LOCK_ALLOWED_COUNTRIES ?? '')
        .split(',')
        .map(c => c.trim().toUpperCase())
        .filter(Boolean)

// The reader is opened on first use, never at import, and shared afterwards.
// watchForUpdates picks up a database replaced in place on a writable volume.
let readerPromise
export const getGeoipReader = (env = process.env) => {
    if (!readerPromise) {
        const path = geoipDatabasePath(env)
        readerPromise = existsSync(path)
            ? maxmind.open(path, {watchForUpdates: true, watchForUpdatesNonPersistent: true})
            : Promise.resolve(undefined)
        // A failed open is not cached, so a later call retries.
        readerPromise.catch(() => { readerPromise = undefined })
    }
    return readerPromise
}

export const resetGeoipReader = () => {
    readerPromise = undefined
}

// Fails boot when geo-lock is on but has no database to decide with: every
// session would otherwise be pinned to ZZ and the lock would do nothing.
export const validateGeoipConfiguration = async (env = process.env) => {
    if (!geoLockEnabled(env)) return
    const reader = await getGeoipReader(env)
    if (!reader) {
        throw new Error(`GEO_LOCK_ENABLED=true but no GeoIP database at ${geoipDatabasePath(env)} (GEOIP_DATABASE_PATH)`)
    }
}

export const countryFromRecord = (record) =>
    record?.country?.iso_code ?? record?.registered_country?.iso_code ?? UNKNOWN_COUNTRY

// The country of an address, ZZ when it cannot be placed, or undefined when no
// database is available at all.
export const countryOf = async (ip, env = process.env) => {
    const reader = await getGeoipReader(env)
    if (!reader) return undefined
    if (!ip || !maxmind.validate(ip)) return UNKNOWN_COUNTRY
    return countryFromRecord(reader.get(ip))
}

// The free databases are licensed on condition of attribution wherever their
// data is shown (DB-IP Lite: CC BY 4.0; GeoLite: CC BY-SA 4.0).
const ATTRIBUTIONS = [
    [/^DBIP/i, {text: 'IP geolocation by DB-IP', url: 'https://db-ip.com'}],
    [/^GeoLite/i, {text: 'GeoLite data created by MaxMind', url: 'https://www.maxmind.com'}],
]

export const attributionFor = (databaseType) =>
    ATTRIBUTIONS.find(([pattern]) => pattern.test(databaseType ?? ''))?.[1]

// Country plus the attribution its database requires, for display next to an
// address. Undefined without a database.
export const geoOf = async (ip, env = process.env) => {
    const reader = await getGeoipReader(env)
    if (!reader) return undefined
    return {country: await countryOf(ip, env), attribution: attributionFor(reader.metadata?.databaseType)}
}

// null when a request from `country` may use a session pinned to `pinned`.
// A session without a pin fails closed: one fresh authentication pins it.
export const geoLockFailure = (pinned, country, env = process.env) => {
    if (!pinned) return GEO_LOCK_UNPINNED
    if (country === pinned) return null
    if (allowedCountries(env).includes(country)) return null
    return GEO_LOCK_COUNTRY
}
