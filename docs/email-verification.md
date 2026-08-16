# Email verification claims

Passmower tracks verification evidence for each normalized email address. It
does not treat verification as an account-wide property: proving control of one
address never verifies another address that later becomes primary.

Evidence is projected into `OIDCUser.status.emailVerifications` with its status,
method, provider, and an optional verification timestamp. Provider-backed
evidence is recomputed from the provider data stored on the user; magic-link
evidence is durable status maintained by Passmower.

The current evidence rules are:

- GitHub is verified only when the matching `/user/emails` result explicitly
  has `verified: true`. GitHub entries stored before this field was added remain
  `unknown` until the user signs in with GitHub again or completes a magic-link
  challenge.
- Generic OIDC providers, including Google, are verified only when the validated
  ID token or UserInfo response explicitly contains `email_verified: true`.
  Explicit `false` is unverified and an omitted claim is unknown.
- Entra ID email, `preferred_username`, tenant membership, and domain names do
  not imply verification. Without an explicit trustworthy claim, use the
  Passmower magic-link login to prove control.
- Passmower currently has no dedicated Discord adapter. A future adapter must
  retain Discord's explicit per-address `verified` result rather than infer it.
- Providers such as Codeberg or Forgejo follow the same rule: use explicit
  per-address evidence when available; otherwise use a Passmower magic link.
- Successfully opening a Passmower magic link verifies exactly the challenged
  destination address with method `magic-link` and provider `passmower`.

## Downstream OIDC clients

Clients must both allow and request the `email` scope. Add it to the
`OIDCClient` and include it in the authorization request:

```yaml
spec:
  availableScopes:
    - openid
    - email
    - profile
```

With that scope, Passmower emits `email` and a boolean `email_verified` in ID
tokens and UserInfo. The value is `true` only if at least one trusted evidence
record verifies the exact normalized address emitted as `email`; unknown and
unverified addresses produce `false`. Without the `email` scope, both claims are
omitted.
