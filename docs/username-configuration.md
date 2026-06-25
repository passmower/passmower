# Username configuration

A user's **username** is the `OIDCUser` resource name (`metadata.name`), also called the
`accountId`. It is the OIDC **`sub`** claim and the `username`/`nickname` claims, and it is
**immutable** once a user is created.

## `USERNAME_SOURCE`

A single setting controls how the username is chosen when a **new** user is enrolled:

| Value | Behaviour |
| --- | --- |
| `generated` | A random system id (`u<...>`). |
| `prompt` | The user must pick a custom username via a form. The username is validated (3–15 chars, lowercase alphanumeric, starts with a letter, not blacklisted) and must be unique. |
| `upstream` | Derived from the upstream provider's username — GitHub `login`, or the OIDC `preferred_username`/`nickname`. It is sanitized and run through the same validation/uniqueness checks; if it is missing, invalid, or already taken, Passmower **falls back to the `prompt` form** (pre-filled with the candidate). Email magic-link logins have no upstream username and therefore always fall back to `prompt`. |

Default (Helm `passmower.username_source`): `prompt`.

`sub` always equals the stored `accountId` regardless of this setting — it is stable and unique.
This is intentional: relying parties key off `sub`.

This setting only affects **new** enrollments. Existing users keep their usernames; nothing is
migrated.

## Relationship to `ENROLL_USERS`

`ENROLL_USERS` is separate and orthogonal: it controls whether unknown users may self-enroll at
all. When `ENROLL_USERS=false`, an unknown user is rejected before `USERNAME_SOURCE` is consulted;
users are then provisioned only by an admin (who always supplies the username unless
`USERNAME_SOURCE=generated`).

## Migration from `USE_GITHUB_USERNAME` / `REQUIRE_CUSTOM_USERNAME` (deprecated)

These two flags are replaced by `USERNAME_SOURCE`:

| Old | New |
| --- | --- |
| `REQUIRE_CUSTOM_USERNAME=true` | `USERNAME_SOURCE=prompt` |
| `USE_GITHUB_USERNAME=true` | `USERNAME_SOURCE=upstream` |
| neither | `USERNAME_SOURCE=generated` |

If `USERNAME_SOURCE` is unset, Passmower still derives it from the old env vars and logs a
deprecation warning (both-true resolves to `prompt`). The Helm chart no longer wires the old
values — set `passmower.username_source` instead.

> **Breaking change for `USE_GITHUB_USERNAME=true` deployments.** Previously `sub` was the GitHub
> login while the stored `accountId` was a random id, so `sub` and `accountId` differed (and `sub`
> could change on a GitHub rename). Now `sub` always equals `accountId`. Existing users' `sub` will
> therefore change from their GitHub login to their stored id. Relying parties that stored the old
> `sub` must be reconciled. New users enrolled under `USERNAME_SOURCE=upstream` get the (validated,
> frozen) GitHub login as their `accountId`, so `sub` and the GitHub login coincide going forward.
