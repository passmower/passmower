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
