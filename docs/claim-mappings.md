# Claim mappings

Many applications carry their own role or entitlement model and expect the
identity provider to tell them which one a user has, in a claim of their own
naming. `OIDCClient.spec.claimMappings` derives such a claim from Passmower group
membership, for that client only.

The point is that this needs no support for the specific application: whatever
the app calls its claim and whatever values it accepts, the mapping is written in
the client's own resource, so a new application is onboarded by editing its
`OIDCClient` rather than by changing Passmower.

```yaml
apiVersion: codemowers.cloud/v1
kind: OIDCClient
metadata:
  name: gallery
  namespace: apps
spec:
  displayName: Gallery
  uri: https://gallery.example.com
  redirectUris:
    - https://gallery.example.com/auth/login
  grantTypes: ['authorization_code']
  responseTypes: ['code']
  availableScopes: ['openid', 'profile', 'email']
  claimMappings:
    gallery_role:
      default: user
      rules:
        - value: admin
          groups: ['github:platform-admins']
```

A user in `github:platform-admins` receives `"gallery_role": "admin"`; everyone
else receives `"gallery_role": "user"`.

## Semantics

- **Keyed by claim name.** Each key becomes a claim emitted to this client.
- **Rules are ordered; the first match wins.** A rule matches when the user is in
  *any* of its `groups` (OR). Put the most privileged rule first.
- **`groups` are prefixed names** — `github:admins`, `local:staff` — exactly as
  they appear in the `groups` claim and in `allowedGroups`.
- **`default` is the catch-all.** It applies when no rule matches. A rule with no
  `groups` never matches, so `default` is the only way to express "everyone".
- **No match and no default means no claim.** The claim is omitted rather than
  emitted empty, so an app can tell "no opinion" from "the lowest role".
- **Values are strings.** One rule, one value.

## Where mapped claims appear

Mapped claims are bound to the `openid` scope, which every authorization grants,
so a client does not have to request anything extra to receive them. They are
emitted in the **ID token**, from the **UserInfo endpoint**, and in **JWT access
tokens** (the ones issued when a client requests an RFC 8707 `resource`).

They are evaluated per request from the user's current groups, so a group change
takes effect on the next token — the same freshness as the `groups` claim itself.

Mapped claim names also appear in the discovery document's `claims_supported`
once a client using them has been served, which is an accurate description of
what the issuer emits.

## Reserved claims

A mapping may not name a claim Passmower owns — identity, authorization and
token-shape claims (`sub`, `email`, `email_verified`, `groups`, `username`,
`name`, `aud`, `exp`, …) or one Passmower computes itself (`applications`,
`codemowers.io/namespaces`). This is the same list the claims-enrichment webhook
is filtered against: a claim mapping is configuration, and configuration must not
be able to rewrite who somebody is.

A client whose `claimMappings` names a reserved claim, or uses a claim name that
cannot go in a token, is **refused**: the `OIDCClient` gets
`Ready=False` with reason `InvalidClaimMappings` and a message naming every
problem, a Warning event, and it is not registered with the provider.

```
kubectl describe oidcclient gallery
...
  Conditions:
    Type    Status  Reason                 Message
    Ready   False   InvalidClaimMappings   Invalid spec.claimMappings: claim "groups" is reserved by Passmower
```

## Worked examples

Two applications that came up when this was designed ([#220][issue]), as
illustrations of the same mechanism — neither is special-cased anywhere in
Passmower.

[issue]: https://github.com/passmower/passmower/issues/220

### An app that reads a fixed claim name (Immich)

Immich reads a role claim from UserInfo and accepts two values. The mapping just
has to produce those values under the name it reads:

```yaml
  claimMappings:
    immich_role:
      default: user
      rules:
        - value: admin
          groups: ['github:platform-admins']
```

Check the application's own documentation for the claim name and the values it
accepts; that is the whole integration.

### An app that can read any claim (Grafana)

An application flexible enough to evaluate an expression over its claims usually
needs **no mapping at all**. Grafana's `role_attribute_path` is a JMESPath over
the claims it receives, so it can read the existing `groups` claim directly,
provided the client allows and requests the `groups` scope.

```yaml
# OIDCClient
spec:
  availableScopes: ['openid', 'profile', 'email', 'groups']
```

```ini
# Grafana
[auth.generic_oauth]
scopes = openid profile email groups
role_attribute_path = contains(groups[*], 'github:platform-admins') && 'Admin' || contains(groups[*], 'github:devs') && 'Editor' || 'Viewer'
```

Reach for a mapping when you would rather keep the role policy next to the
client in Git than inside a JMESPath expression in Grafana's config, in which
case a single claim is simpler to read on both sides:

```yaml
  claimMappings:
    grafana_role:
      default: Viewer
      rules:
        - value: Admin
          groups: ['github:platform-admins']
        - value: Editor
          groups: ['github:devs']
```

```ini
role_attribute_path = grafana_role
```

Grafana's `skip_org_role_sync` is unrelated to Passmower — it controls whether
Grafana keeps managing org roles itself, and applies whichever source the role
comes from.

## Relationship to the enrichment webhook

`EXTRA_CLAIMS_WEBHOOK_URL` and claim mappings solve different problems:

| | Claim mappings | Enrichment webhook |
|---|---|---|
| Scope | One client, declared in its `OIDCClient` | Install-wide |
| Source of truth | Group membership, in Git | Any external service |
| Claim names | Chosen per client | Fixed (`codemowers.io/namespaces`) |
| Failure mode | None — pure evaluation | Fail-open: claim absent |

Use a mapping for "this app's roles come from these groups". Use the webhook when
the value has to come from a system outside Kubernetes.
