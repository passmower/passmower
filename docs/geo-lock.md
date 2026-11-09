# Geo-lock: pinning sessions to a country

Geo-lock is opt-in. It limits what a stolen session cookie or refresh token is
worth: a session is pinned to the country it signed in from, and a request from
any other country ends it. The owner signs in again. An attacker holding only the
cookie can't, because signing in needs the upstream login, magic link or passkey.

It is off by default and needs a GeoIP country database.

## How it works

1. **Pin.** Each fresh authentication records the country of the client
   address. That address is the first `X-Forwarded-For` hop, the same one the
   sessions list shows. The pin is stored against the OIDC session.
   Single sign-on into another application keeps the existing pin.
2. **Check.** The pin is checked on every request that uses the session:
   - the Passmower session: dashboard, `/api`, `/admin`, `/auth` and
     interactions;
   - forward-auth site sessions, which carry the country they were issued from;
   - refresh-token grants from **public clients**
     (`tokenEndpointAuthMethod: none`; see below).
3. **Deny.** A request from a country other than the pin, and not in the
   allowlist, gets one of these:
   - The Passmower session is ended. The request continues unauthenticated, so
     the user is asked to sign in.
   - The forward-auth site session is destroyed. The user is sent back through
     authorization, which ends the Passmower session too.
   - The refresh grant is answered with `invalid_grant`.

   A session created before geo-lock was enabled has no pin, and is treated the
   same way: one sign-in pins it.
4. **Recover.** Someone who travels or roams signs in again from where they
   are. That fresh authentication re-pins the session to the new country. No
   admin step is needed.

### Why refresh is checked only for public clients

A public client (an SPA or native app) refreshes from the user's own device,
so the request address is the user's. A confidential client refreshes from its
backend, whose address says nothing about where the user is. Checking it would
either always pass or always fail. Confidential clients are covered by the
session instead: refresh tokens expire with the session, so once a geo-lock
denial ends it, the client's next refresh fails. Access tokens already issued
stay valid until their own expiry.

## Configuration

```yaml
passmower:
  geoip:
    enabled: true            # mounts the database; also shows flags in the dashboard
  geoLock:
    enabled: true
    allowedCountries: [EE, FI]
```

| Value | Env | Meaning |
|---|---|---|
| `geoip.enabled` | `GEOIP_DATABASE_PATH` | Mount a GeoIP country database. |
| `geoip.image` | | Image volume holding the database. Defaults to the published DB-IP image. |
| `geoip.volume` | | Any volume source to use instead of the image. |
| `geoip.file` | | File name of the database inside the volume. |
| `geoLock.enabled` | `GEO_LOCK_ENABLED` | Pin and check sessions. Requires `geoip.enabled`; Passmower refuses to boot when the database cannot be read. |
| `geoLock.allowedCountries` | `GEO_LOCK_ALLOWED_COUNTRIES` | ISO 3166 codes accepted for every session, whatever its pin. |

### Unplaceable addresses: `ZZ`

The database can't place private, loopback or unallocated addresses, so they
resolve to `ZZ`. A session pinned from such an address works from any other
`ZZ` address. List `ZZ` in `allowedCountries` to let users reach a pinned
session over an internal network as well, for example a VPN that terminates
in-cluster.

### Roaming caveats

GeoIP is an approximation. Mobile carriers, VPNs, iCloud Private Relay and
corporate egress can place a user in a different country from the one they are
in, or switch countries between requests. Each switch costs one sign-in.
Neighbouring countries users regularly appear from belong in
`allowedCountries`.

Geo-lock relies on `X-Forwarded-For` being set by your ingress. Make sure the
ingress overwrites any client-supplied value. Otherwise a client can claim any
country.

## GeoIP database

Passmower reads any country database in MaxMind DB format (`.mmdb`), such as
DB-IP Lite Country or MaxMind GeoLite2/GeoIP2 Country.

The chart's default is `ghcr.io/passmower/geoip-country`, a data-only image of
**DB-IP Lite Country**. It is republished monthly by
`.github/workflows/geoip-image.yml` and tagged both `YYYY-MM` and `latest`. It
is mounted as a Kubernetes image volume, which needs the ImageVolume feature
(beta since Kubernetes 1.33). With `pullPolicy: Always`, every pod start takes
the latest month. Pin a `YYYY-MM` tag instead for reproducible rollouts.

On a cluster without image volumes, set `geoip.volume` to any volume source
that holds the file. One option is a PVC kept current by MaxMind's
`geoipupdate`:

```yaml
passmower:
  geoip:
    enabled: true
    volume:
      persistentVolumeClaim:
        claimName: geoip
    file: GeoLite2-Country.mmdb
```

Passmower watches the file and picks up a replaced database without a restart.

### Attribution

DB-IP Lite is licensed under
[CC BY 4.0](https://creativecommons.org/licenses/by/4.0/), and MaxMind GeoLite
under CC BY-SA 4.0. Both require attribution wherever their data is shown.
Passmower reads the database type and shows the matching notice ("IP
geolocation by DB-IP", or the MaxMind equivalent) under the country flags in
the dashboard.

## Auditing

Every denial produces:

- a log line, `Session rejected by geo-lock…`, carrying `pinnedCountry`,
  `country`, `failure` and `source`;
- an audit record with `event: session.geo.denied` (see
  [audit-logging.md](audit-logging.md));
- a recent-access incident in the admin view, with source `geo-lock:<source>`;
- an increment of `passmower_geo_lock_denied_count{source, reason}`, where
  `source` is `oidc-session`, `site-session` or `refresh`, and `reason` is
  `geo_lock_country` or `geo_lock_unpinned`.
