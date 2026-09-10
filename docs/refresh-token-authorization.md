# Refresh-token authorization

Passmower re-evaluates the current Kubernetes account whenever a refresh token
is exchanged. A refresh token is rejected with the standard OAuth
`invalid_grant` response when the account:

- no longer exists;
- no longer satisfies the global `REQUIRED_GROUP` approval policy;
- no longer has the profile name required by the login policy;
- no longer has a required Terms of Service acceptance; or
- no longer matches the OIDC client `allowedUsers` / `allowedGroups` policy.

This check uses the latest `OIDCUser` and client state rather than a snapshot
stored in the refresh token. Policy changes therefore take effect on the next
refresh exchange without waiting for the token TTL. Access tokens already
issued before the change remain valid until their own expiry; resource servers
that need faster revocation should use short access-token lifetimes or token
introspection.

Clients should handle `invalid_grant` by discarding the refresh token and
starting a new interactive authorization flow. If the account is still
eligible, that flow can satisfy any newly required prompt and establish a new
grant.

## Getting a refresh token

A refresh token goes to any client allowed the `refresh_token` grant. That is
the whole requirement — add `refresh_token` to the client's `spec.grantTypes`:

```yaml
spec:
  grantTypes:
    - authorization_code
    - refresh_token
```

`oidc-provider`'s own default also requires the `offline_access` scope in the
grant, which OIDC Core §11 ties to `prompt=consent`. Passmower does not, because
these tokens are not offline access: they expire with the session, so they only
renew silently while the user is still signed in. Requiring the consent ceremony
for that would take renewal away from every client whose relying party does not
send the prompt, and buy nothing.

| client `grantTypes` | refresh token | `offline_access` in the grant |
|---|---|---|
| includes `refresh_token` | yes | only with `prompt=consent` |
| no `refresh_token` | no | no |

A client without the grant gets none. It used to be handed one the token
endpoint then refused with `requested grant type is not allowed for this
client` — a dead credential rather than a feature. If its application asked for
`offline_access`, that mismatch is logged, since it is otherwise silent
(sign-in succeeds and only renewal is missing):

```
Refresh token withheld: client is not allowed the refresh_token grant
  clientId: apps.grafana
```

## Where offline_access does and does not matter

`offline_access` decides what the *grant* records, not whether a refresh token is
issued. `oidc-provider` removes the scope from an authorization request unless
**all three** hold (its authorization `scopes.js`):

1. the response type returns an authorization code,
2. the client is allowed the `refresh_token` grant, and
3. the request carries **`prompt=consent`**.

The third is the one that catches people:

```
GET /auth?client_id=…&scope=openid%20offline_access             → granted: openid
GET /auth?client_id=…&scope=openid%20offline_access&prompt=consent
                                                                → granted: openid offline_access
```

Note what is *not* on that list: `spec.availableScopes`. Passmower does not
restrict requested scopes to it, so `offline_access` reaches the grant whether or
not the client lists it — `availableScopes` only populates
`OIDC_AVAILABLE_SCOPES` in the generated Secret and lets the grant carry the
scope. Listing it tells the consuming application what it may request; it does
not decide what is issued.

Since `expiresWithSession` ends every token with the session regardless,
`offline_access` in the grant currently records the request rather than granting
an exemption from session lifetime. A relying party that genuinely needs access
while the user is away should request it with `prompt=consent` — and know that
the session still bounds it today.
