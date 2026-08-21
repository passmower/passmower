# OIDCUser account types

`OIDCUser.spec.type` controls whether an object represents a person who can
authenticate or a non-login identity used for provisioning and administration.

| Type | Ordinary login | Admin impersonation | Purpose |
| --- | --- | --- | --- |
| unset | Allowed | Allowed | Legacy users; treated as `person`. |
| `person` | Allowed | Allowed | Human user account. |
| `service` | Denied | Allowed | Non-interactive or application-local identity that an administrator may inspect through explicit impersonation. |
| `org` | Denied | Denied | Organization identity and reserved name. |
| `group` | Denied | Denied | Group identity used for provisioning and ownership. |
| `banned` | Denied | Denied | Reserved account name whose owner must not authenticate. |

Unknown values are denied even if they enter storage outside CRD validation.
Changing an existing person to a non-login type terminates Passmower's live OIDC
and admin sessions, prevents refresh-token use, rejects Passmower bearer APIs,
and stops forward-auth from returning identity headers. All ordinary login
methods share the same check, including GitHub, generic OIDC, email links, and
passkeys.

Service-account impersonation is the only type-specific exception. It still uses
the ordinary client approval, group, and other access policies; it does not turn
a service account into a generally login-capable identity. Impersonation of
`banned`, `org`, and `group` accounts is refused.

Self-contained JWT access tokens already issued to an account cannot be recalled
from Passmower. Resource servers may continue accepting one until its normal
expiry. Use short access-token lifetimes where rapid offboarding is required;
Passmower rejects refresh and all server-side session paths immediately.
