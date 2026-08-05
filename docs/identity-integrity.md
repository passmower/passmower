# User identity integrity

Passmower treats email addresses as account-linking claims, while retaining the
upstream provider's immutable subject as the durable identity after the first
login. This allows a user to add a new provider with an existing email and to
keep the same account when an upstream email changes, without allowing a newer
`OIDCUser` to take over an address already claimed by an older resource.

## Duplicate email ownership

Every email claimed in `spec.email`, `spec.companyEmail`, `passmower.email`,
GitHub email data, or a generic OIDC identity is canonicalized and compared.
Comparison is case-insensitive and trims whitespace. When
`normalizeEmailAddresses` / `NORMALIZE_EMAIL_ADDRESSES` is enabled, Passmower
also applies provider-specific normalization such as removing Gmail `+tag`
aliases.

If multiple `OIDCUser` resources claim the same canonical address, ownership is
deterministic: the resource with the oldest `metadata.creationTimestamp` wins,
with the resource name as a tie-breaker. A losing resource receives:

```yaml
status:
  conditions:
    - type: EmailUnique
      status: "False"
      reason: DuplicateEmail
      message: person@example.com is owned by OIDCUser original-user
```

The conflicted resource is excluded from email and upstream-subject login. The
original owner remains usable. Passmower also emits a Kubernetes warning Event,
sets `passmower_oidc_user_email_conflicts` to the number of conflicted users,
shows the refined conflict reason in the admin UI, and exposes the condition in
the `kubectl get oidcusers` table. Once the duplicate claim is removed, the
condition returns to `True` automatically.

To remediate, inspect all claims on the named resources, remove or correct the
duplicate claim in Git, and let the operator reconcile. Do not delete the older
resource merely to transfer ownership unless that transfer is intentional: once
it is gone, the next-oldest claimant becomes the owner.

## Login and account linking

On generic OIDC login, Passmower first looks for the configured provider key and
the provider's `sub`. GitHub uses its numeric user ID in the same way. If that
stable identity is already attached, it selects the existing `OIDCUser` even if
the upstream email changed. Otherwise, verified upstream email addresses are
used to find an existing account, so signing in through a new provider with the
same email links that provider to the existing user.

Authentication is stopped when multiple incoming emails resolve to different
users, when a stable subject and its current email resolve to different users,
or when a stable subject is attached to more than one resource. These cases
require an administrator to resolve the CRDs; Passmower will not guess or merge
them automatically.

GitHub contributes only email addresses reported as verified. Generic OIDC
rejects an explicitly unverified email (`email_verified: false`); providers that
omit the claim retain the existing compatibility behavior. Email magic links
prove control of the destination address directly.

## Related configuration

- `ENROLL_USERS=false` prevents creation of an unknown account. It does not
  disable linking a new upstream identity to an existing email owner.
- `USERNAME_SOURCE` affects only the name chosen for a newly enrolled
  `OIDCUser`; it does not participate in matching existing identities.
- `NORMALIZE_EMAIL_ADDRESSES` controls canonicalization for both CRD claims and
  login claims. Review conflicts before changing it on an existing deployment.
- `PREFERRED_EMAIL_DOMAIN` chooses the primary address among an account's
  claims. It does not change ownership or linking decisions.

Kubernetes RBAC is still the security boundary for declarative user changes.
Deploy Passmower in its dedicated namespace and restrict `OIDCUser` writes to
trusted administrators and CI controllers.
