# Email verification claims

Passmower tracks verification evidence for each normalized email address. It
does not treat verification as an account-wide property: proving control of one
address never verifies another address that later becomes primary.

Email is optional when delivery is globally disabled. Accounts without a
primary address omit both downstream email claims; see
[email-configuration.md](email-configuration.md).

Evidence is projected into `OIDCUser.status.emailVerifications` with its status,
method, provider, and an optional verification or observation timestamp. Provider-backed
evidence is recomputed from the provider data stored on the user; magic-link
evidence is durable status maintained by Passmower. Magic-link evidence remains
stored if its address is temporarily unlinked, but it can only affect claims
when that exact address is selected as the current primary email.

Provider evidence is an observation, not an indefinite guarantee. Passmower
replaces it at the next login and ignores it while an identity is inactive or
after it is removed. It cannot immediately observe upstream revocation or later
address reassignment. `observedAt` records when Passmower last saw the provider
signal; applications needing fresh mailbox control should require a magic link.

## Provider trust matrix

| Upstream | Evidence source | `true` / `false` / missing | Trusted for mailbox control | Passmower rule |
|---|---|---|---|---|
| GitHub | [`GET /user/emails`](https://docs.github.com/en/rest/users/emails#list-email-addresses-for-the-authenticated-user) `verified` for each exact address | verified / unverified / unknown on legacy records | Yes | Dedicated adapter retains only explicit `verified: true`, including Primary/Verified/Private addresses, as `github-api` evidence. A legacy record must reauthenticate or use a magic link. |
| Google | Validated [ID token or UserInfo `email_verified`](https://developers.google.com/identity/openid-connect/reference) | verified / unverified / unknown | Yes | `https://accounts.google.com` automatically enables `oidc-claim` evidence. Email domain and `hd` never verify an address. |
| GitLab.com | Validated [`email_verified`](https://docs.gitlab.com/integration/openid_connect_provider/) with the `email` scope | verified / unverified / unknown | Yes | `https://gitlab.com` automatically enables `oidc-claim` evidence. Self-hosted GitLab requires the explicit configuration below. |
| Microsoft Entra ID | `email`, `preferred_username`, tenant and domain claims | unknown | No | Always defaults to `none`. Microsoft documents `email` as mutable and not guaranteed correct; none of these values proves mailbox control. |
| Dex | Validated [`email_verified`](https://dexidp.io/docs/configuration/custom-scopes-claims-clients/) relayed from its connector | verified / unverified / unknown | Configuration-dependent | Defaults to `none`. Opt in only after auditing every connector and ensuring options such as `insecureSkipEmailVerified` are disabled. |
| Discord | [`GET /users/@me`](https://docs.discord.com/developers/resources/user) `verified` with the `email` scope | verified / unverified / unknown | Yes | Not currently implemented: Discord is OAuth2, not an OIDC issuer. A dedicated adapter is useful if Discord login is added and must store `discord-api` evidence for the exact returned address. |
| Codeberg / Forgejo | OAuth2 user profile email; no documented OIDC per-address verification contract | unknown | No | Defaults to `none`; use a magic link. Do not infer verification from account presence or Forgejo email-confirmation settings. |
| Other generic OIDC | Provider-specific | unknown by default | No by default | A claim named `email_verified` is not silently trusted. Explicitly opt in only after auditing the issuer's contract. |
| Passmower email | Successfully opened challenge sent to the exact address | verified | Yes | Stored durably as `magic-link` / `passmower` evidence with `verifiedAt`. |

For a self-hosted provider whose documented semantics are equivalent to Google
or GitLab, enable the capability explicitly:

```yaml
passmower:
  oidcProviders:
    gitlab:
      issuer: https://gitlab.example.com
      emailVerification: oidc-claim
      clientSecretRef: gitlab-client
```

Use `emailVerification: none` to override an automatic Google or GitLab.com
default. Passmower accepts provider login when the signal is missing, but stores
unknown evidence and emits downstream `email_verified: false`. An explicit
upstream `false` remains a login error. ID-token evidence is used for a UserInfo
email only when both responses contain the same normalized address; disagreement
cannot transfer verification to a replacement primary address.

## Remediation and lifecycle

- Reauthenticate with GitHub or the OIDC provider to replace legacy or stale
  provider observations.
- Use Passmower magic-link login when the provider has no trustworthy signal or
  when recent mailbox control matters.
- Deactivate or remove a linked identity to stop its provider evidence from
  affecting downstream claims. Durable magic-link evidence is retained, but is
  effective only while its exact address remains the selected primary email.
- Changing the primary address always re-evaluates evidence by normalized exact
  address; verification is never copied from the previous primary address.

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
