# Address gate: one allowlist of client addresses for every application

The address gate is opt-in. It keeps traffic from unknown networks away from
your applications altogether, the way a VPN would, without a VPN client. It is
a single allowlist of client addresses, served by Passmower as a Traefik
`forwardAuth` middleware and attached to the applications' Ingresses.

A request passes when its client address matches any of:

- **a range** in `allowedRanges` (office, VPN or cluster networks);
- **a country** in `allowedCountries`;
- **a network** in `allowedAsns`: the autonomous system announcing the
  address, which for home and mobile connections is the ISP;
- **a session**: someone currently signed in to Passmower unlocked the address
  they are on.

Everything else is refused before it reaches the application, including the
application's own login page and any unauthenticated endpoints.

It complements [geo-lock](geo-lock.md): geo-lock decides whether a *session*
may be used from an address, the gate decides whether an *address* may reach an
application at all.

## The session unlock

A browser loading a page from an address no static rule allows is redirected to
Passmower:

1. If the browser is not signed in, the user signs in as usual.
2. Passmower records that this session vouches for the address it is on and
   sends the browser back to the page it asked for.
3. The address stays open while that session is alive. Signing out, session
   expiry or a geo-lock denial closes it again on the next request.

So a colleague abroad opens any gated application, signs in once, and is
through. Nobody else on the internet gets as far as the application.

Points to know:

- **Only page loads are redirected.** API calls, assets, form posts and
  WebSocket upgrades from a refused address get a plain `403`. A client that
  cannot follow a browser sign-in (a CLI, a mobile app, a webhook sender) must
  come from a range, country or network on the list.
- **Addresses are shared.** Everyone behind the same NAT address is let through
  once one of them unlocks it. An IPv6 unlock covers the `/64` the address is
  in, because hosts rotate their address within it. The gate reduces exposure;
  the application's own authentication still decides who gets in.
- **IPv4 and IPv6.** The unlock records the address the browser reaches
  *Passmower* from. If the browser reaches the application over the other
  address family, the gate keeps refusing it; Passmower detects the repeat and
  shows an explanation instead of looping. Publish the same record types
  (A and AAAA) for Passmower and the applications, or allow the network with a
  static rule.
- Set `sessionUnlock: false` to apply the static rules only.

## Configuration

```yaml
passmower:
  geoip:
    enabled: true          # country database, for allowedCountries
    asn:
      enabled: true        # ASN database, for allowedAsns
  addressGate:
    enabled: true
    allowedCountries: [EE]
    allowedAsns: [AS3249, AS2586]
    allowedRanges: [172.28.0.0/16, 193.40.103.0/24, "2001:db8::/32"]
```

| Value | Env | Meaning |
|---|---|---|
| `addressGate.enabled` | `ADDRESS_GATE_ENABLED` | Serve the gate and create its Middleware. |
| `addressGate.allowedCountries` | `ADDRESS_GATE_ALLOWED_COUNTRIES` | ISO 3166 country codes. Needs `geoip.enabled`. |
| `addressGate.allowedAsns` | `ADDRESS_GATE_ALLOWED_ASNS` | AS numbers, with or without the `AS` prefix. Needs `geoip.asn.enabled`. |
| `addressGate.allowedRanges` | `ADDRESS_GATE_ALLOWED_RANGES` | CIDR ranges or single addresses, IPv4 or IPv6. |
| `addressGate.sessionUnlock` | `ADDRESS_GATE_SESSION_UNLOCK` | Let signed-in users unlock their address (default on). |
| `addressGate.middleware.enabled` | | Create the Traefik `Middleware`. |
| `addressGate.admissionPolicy.*` | | Attach the middleware to Ingresses automatically; see below. |
| `geoip.asn.*` | `GEOIP_ASN_DATABASE_PATH` | The ASN database: image volume or any volume source, as for the [country database](geo-lock.md#geoip-database). |

Passmower refuses to boot on a malformed range or AS number, and on a country
or ASN rule whose database cannot be read. The chart refuses to render those
rules without the matching database enabled.

The rules are evaluated in memory; only the session unlock reads Redis. An
address matching a static rule costs the application request one in-cluster
round trip to Passmower and no storage access.

### Choosing rules

- A country is the broadest rule: it also admits every hosting provider and VPN
  exit in that country.
- ASNs are narrower. Listing the consumer ISPs your users are on admits home
  and mobile connections without admitting data centres. The free database
  names the network operator, which for retail connections is the ISP; it has
  no "hosting" or "VPN" classification.
- Ranges are for networks you control.

## Attaching the gate to applications

The chart creates a `Middleware` named `<fullname>-address-gate` in Passmower's
namespace. Reference it from an Ingress:

```yaml
metadata:
  annotations:
    traefik.ingress.kubernetes.io/router.middlewares: passmower-passmower-address-gate@kubernetescrd
```

or from an `IngressRoute`'s `middlewares` list (with
`namespace: <passmower namespace>`; cross-namespace references need Traefik's
`allowCrossNamespace`). Put it ahead of other middlewares, so a refused address
does not reach them.

### Automatically, with an admission policy

```yaml
passmower:
  addressGate:
    admissionPolicy:
      enabled: true
      namespaceSelector:
        matchLabels:
          codemowers.cloud/address-gate: enabled
```

This installs a `MutatingAdmissionPolicy` that prepends the middleware to the
`router.middlewares` annotation of every Ingress created or updated in the
selected namespaces. It needs the Kubernetes `MutatingAdmissionPolicy` API
(`admissionregistration.k8s.io/v1beta1` from 1.34, behind its feature gate
until it is on by default; set `admissionPolicy.apiVersion` to match your
cluster).

- **Passmower's own Ingress is never gated**, or nobody outside the allowlist
  could sign in to unlock their address.
- Label any other Ingress `codemowers.cloud/address-gate: exempt` to leave it
  out. An upstream identity provider that users sign in through (Dex, for
  example) must be exempt for the same reason, as must public sites and
  webhook receivers.
- Existing Ingresses are picked up the next time they are updated. Disabling
  the policy does not remove the annotation from Ingresses that already have
  it.
- `IngressRoute` resources are not mutated; list the middleware on their
  routes.

## Trusting the client address

The gate reads the first `X-Forwarded-For` entry, as the sessions list, the
site-session IP binding and geo-lock do. It is only as good as the proxy that
sets it:

- Traefik must see the real client address. Behind a load balancer that means
  `externalTrafficPolicy: Local` or the PROXY protocol.
- Traefik must not accept `X-Forwarded-For` from clients. That is its default;
  do not set `forwardedHeaders.insecure`, and keep `forwardedHeaders.trustedIPs`
  to proxies you run.

The endpoint itself (`/address-gate`) only answers whether the caller's address
is allowed. It never lists addresses.

## Auditing and metrics

- Each unlock writes a log line with the account, the unlocked address and the
  application host, and an audit record with `event: address-gate.unlocked`
  (see [audit-logging.md](audit-logging.md)).
- `passmower_address_gate_request_count{result, rule}` counts gate decisions;
  `rule` is `range`, `country`, `asn`, `session` or `none`.
- `passmower_address_gate_unlock_count` counts unlocks.

Refused requests are counted but not logged above debug level: on a public
address they are mostly internet background noise.

## Attribution

The default databases are DB-IP Lite Country and ASN, licensed under
[CC BY 4.0](https://creativecommons.org/licenses/by/4.0/): IP Geolocation by
[DB-IP](https://db-ip.com).
