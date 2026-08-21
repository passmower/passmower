# Migrating from Passmower 1.x to 2.0

Passmower 2.0 is a major release. It carries four consumer-facing breaking changes
(Helm values, one `OIDCClient` CRD field, standard OIDC email scoping, and strict email configuration) plus a sweep of major dependency
upgrades. This note lists everything you must change, and what changed for the better.

> The 2.0 line ships from the `develop` branch as `2.0.0-dev` (image
> `ghcr.io/passmower/passmower:2.0.0-dev`, chart
> `oci://ghcr.io/passmower/charts/passmower --version 2.0.0-dev`) until `2.0.0` is
> cut on `master`. Use it on non-production / dev clusters first.

## Before you start

- Back up your `values.yaml` (or HelmRelease/ArgoCD Application values).
- Back up your `OIDCClient` and `OIDCUser` custom resources:
  `kubectl get oidcclients,oidcusers,oidcmiddlewareclients -A -o yaml > passmower-crs.bak.yaml`.
- Read the **action required** sections below and edit your values / CRs before
  upgrading.

---

## Email configuration is now enforced — **action required**

`EMAIL_ENABLED` is now the global switch for every email-dependent feature, not
only magic-link login. It defaults to enabled. When enabled, Passmower validates
`EMAIL_HOST`, `EMAIL_PORT`, `EMAIL_SSL`, `EMAIL_USERNAME`, and `EMAIL_PASSWORD` at
boot and exits if any are missing. The Helm chart likewise rejects an enabled
configuration without `passmower.emailCredentialsSecretRef`.

Deployments that previously left email enabled but supplied incomplete or no SMTP
configuration will crash-loop after upgrading. Before upgrading, choose one of:

- configure a credentials Secret containing all five required variables and set
  `passmower.emailCredentialsSecretRef`, or
- set `passmower.emailEnabled: false` explicitly. This disables SMTP delivery,
  magic-link login, ToS receipts, and email invitations while permitting users to
  enroll through GitHub or another OIDC provider using their stable upstream
  identity without an email address.

SMTP delivery errors are no longer swallowed. A failed magic-link send now fails
that login attempt; ToS acceptance remains successful if its receipt cannot be sent.
See [email-configuration.md](email-configuration.md) for the complete behavior.

---

## 1. Helm values renamed to camelCase — **action required**

All `passmower.*` and `passmower.texts.*` value keys moved from `snake_case` to
`camelCase` to follow Helm conventions. Rename them in your values:

| 1.x | 2.0 |
| --- | --- |
| `passmower.group_prefix` | `passmower.groupPrefix` |
| `passmower.admin_group` | `passmower.adminGroup` |
| `passmower.required_group` | `passmower.requiredGroup` |
| `passmower.github_organization` | `passmower.githubOrganization` |
| `passmower.username_source` | `passmower.usernameSource` |
| `passmower.enroll_users` | `passmower.enrollUsers` |
| `passmower.disable_frontend_edit` | `passmower.disableFrontendEdit` |
| `passmower.namespace_selector` | `passmower.namespaceSelector` |
| `passmower.preferred_email_domain` | `passmower.preferredEmailDomain` |
| `passmower.normalize_email_addresses` | `passmower.normalizeEmailAddresses` |
| `passmower.webauthn_enabled` | `passmower.webauthnEnabled` |
| `passmower.github_enabled` | `passmower.githubEnabled` |
| `passmower.email_enabled` | `passmower.emailEnabled` |
| `passmower.email_credentials_secretRef` | `passmower.emailCredentialsSecretRef` |
| `passmower.github_client_secretRef` | `passmower.githubClientSecretRef` |
| `passmower.slack_client_secretRef` | `passmower.slackClientSecretRef` |
| `passmower.texts.terms_of_service` | `passmower.texts.termsOfService` |
| `passmower.texts.disable_frontend_edit` | `passmower.texts.disableFrontendEdit` |
| `passmower.texts.emails.login_link` | `passmower.texts.emails.loginLink` |
| `passmower.texts.emails.terms_of_service` | `passmower.texts.emails.termsOfService` |

These rendered **environment variables** keep their names (`GROUP_PREFIX`,
`USERNAME_SOURCE`, …). Their values are unchanged except for the `OIDC_PROVIDERS`
shape described below.

### OIDC providers changed from a list to a map

`passmower.oidcProviders` is now keyed by provider slug. This makes provider-specific
overrides merge cleanly across Helm values files. Move each entry's `key` into the map
key and optionally set a numeric `order` for its position on the sign-in page:

```diff
 passmower:
   oidcProviders:
-    - key: google
+    google:
+      order: 10
       displayName: Google
       issuer: https://accounts.google.com
       clientSecretRef: google-client
```

Providers are sorted by ascending `order`, then by provider key when `order` is equal
or omitted. If you inject `OIDC_PROVIDERS` directly, change its JSON value from an
array to an object with the same keyed shape. The legacy array shape is no longer
accepted.

### Removed deprecated keys

`passmower.use_github_username` and `passmower.require_custom_username` are removed —
they were already non-functional in 1.3.0. Use `passmower.usernameSource` instead
(`upstream` ≈ old `use_github_username: true`, `prompt` ≈ old
`require_custom_username: true`). See [username-configuration.md](username-configuration.md).

---

## 2. `OIDCClient.spec.secretRefreshPod` → `spec.secretRefreshJobSpec` — **action required if used**

The post-rotation "refresh" hook now runs as a Kubernetes **Job** instead of a bare
**Pod**. A Job is retried by the scheduler when it fails and exposes the
`kube_job_failed` metric, so a refresh that never succeeds is now both retried and
alertable (see section 5).

The field is renamed **and** its shape changed: you previously supplied a whole Pod
manifest; you now supply a `JobSpec` (the `.spec` of a `batch/v1` Job), so the pod
template moves under `template.spec`.

**Before (1.x):**

```yaml
apiVersion: codemowers.cloud/v1beta1
kind: OIDCClient
spec:
  # ...
  secretRefreshPod:
    spec:
      restartPolicy: Never        # was the default
      containers:
        - name: refresh
          image: bitnami/kubectl
          command: ["kubectl", "rollout", "restart", "deployment/my-app"]
```

**After (2.0):**

```yaml
apiVersion: codemowers.cloud/v1beta1
kind: OIDCClient
spec:
  # ...
  secretRefreshJobSpec:
    template:
      spec:
        restartPolicy: OnFailure  # now the default; allows retries
        containers:
          - name: refresh
            image: bitnami/kubectl
            command: ["kubectl", "rollout", "restart", "deployment/my-app"]
    # any other JobSpec fields are allowed, e.g.:
    # backoffLimit: 4
    # ttlSecondsAfterFinished: 600   # defaults to 3600 if unset
```

Passmower still owns the resulting Job (owner-referenced to the `OIDCClient`, so it is
garbage-collected with it) and stamps it with `app.kubernetes.io/managed-by=passmower`,
`app.kubernetes.io/component=secret-refresh`, and `codemowers.cloud/oidc-client=<name>`
labels.

> A leftover `secretRefreshPod` field on an existing `OIDCClient` is simply ignored by
> 2.0 — the refresh hook silently stops running until you migrate it to
> `secretRefreshJobSpec`.

---

## 3. Add the `email` scope to clients that consume email claims — **action required**

Passmower 1.x emitted `email` with the `profile` scope. Passmower 2.0 follows the
standard OIDC scope boundary: `email` and `email_verified` are emitted only when
the relying party is allowed to request, and actually requests, the `email` scope.

Add `email` to each affected `OIDCClient` and to the relying party's authorization
request. Otherwise authentication continues to work, but both email claims are
omitted.

```diff
 spec:
   availableScopes:
     - openid
+    - email
     - profile
```

Existing GitHub identities must sign in through GitHub once after upgrade to
capture GitHub's explicit per-address verification result. Alternatively, users
can prove control through a Passmower magic link. Passmower does not infer
verification from legacy records that lack evidence.

See [email-verification.md](email-verification.md) for provider-specific trust rules.

---

## 4. CRDs promoted to `codemowers.cloud/v1` — **no immediate action, but migrate your manifests**

The custom resources (`OIDCUser`, `OIDCClient`, `OIDCMiddlewareClient`) are promoted
from `codemowers.cloud/v1beta1` to **`codemowers.cloud/v1`**. This is done the
non-breaking way:

- The CRDs serve **both** versions. `v1` is now the **storage** version; `v1beta1` is
  still **served but marked deprecated** (the API server returns a deprecation warning —
  e.g. `kubectl` prints "codemowers.cloud/v1beta1 ... is deprecated; use
  codemowers.cloud/v1"). The two versions share an identical schema, so conversion is
  `strategy: None` (no conversion webhook needed).
- **Nothing breaks on upgrade.** Your existing `apiVersion: codemowers.cloud/v1beta1`
  resources keep working and Passmower reconciles them unchanged. As they are re-applied
  or updated they are rewritten to `v1` storage.

**What to do (at your own pace):** update the `apiVersion` in your `OIDCUser` /
`OIDCClient` / `OIDCMiddlewareClient` manifests from `codemowers.cloud/v1beta1` to
`codemowers.cloud/v1`. The `spec` is unchanged — only the `apiVersion` line moves.

```diff
- apiVersion: codemowers.cloud/v1beta1
+ apiVersion: codemowers.cloud/v1
  kind: OIDCClient
  # spec unchanged
```

> `v1beta1` will be **removed in a future release**. Migrate your manifests during the
> 2.0 window so the eventual removal is a no-op for you. (A version can only be dropped
> once no stored objects remain on it — re-applying your resources as `v1` ensures that.)

### Terms of Service acceptance moved out of conditions

ToS acceptance is durable account state, not an observation about the current
resource, so new acceptances are stored under `OIDCUser.status.termsOfService` with
`acceptedAt` and `contentHash` fields. Empty or whitespace-only ToS content disables
the acceptance prompt and receipt entirely. When configured content changes, its
hash changes and people must accept the new version.

Passmower continues to recognize the legacy
`status.conditions[type=ToSv1]` entry and automatically replaces it on the next status
write, using the currently configured content hash as its baseline. No user action or
renewed acceptance is required during migration. External tooling that reads the old
condition should switch to `status.termsOfService.acceptedAt`.

---

### Non-person account types no longer permit ordinary login

Passmower 2.0 enforces `OIDCUser.spec.type` at every server-controlled access
boundary. Only `person` and legacy unset types may log in normally. `service`
accounts may only be entered through an explicit admin impersonation link;
`org`, `group`, `banned`, and unknown types cannot be impersonated or log in.

If a 1.x deployment assigned one of these types to a login-capable user, change
it to `person` before upgrading. See [account-types.md](account-types.md) for the
complete matrix and the expiry limitation for already-issued JWT access tokens.

Forward-auth now rechecks the full account access policy on every request. A user
whose approval, required profile name, current ToS acceptance, or client group/user
membership is revoked receives 401 from legacy applications without waiting for the
existing site session to expire.

---

## 5. RBAC change — automatic

The chart's `ClusterRole` now grants `create` on `batch/jobs` instead of core `pods`
(the operator creates the refresh **Job** described above). This is applied for you by
`helm upgrade`. You only need to act if you manage Passmower's RBAC out of band (e.g. a
hand-maintained `ClusterRole`): grant `create` on `jobs` in the `batch` API group, and
you may drop the old `pods` `create` grant.

---

## 6. Major dependency upgrades — informational

2.0 upgrades several runtime dependencies across major versions, most notably
`oidc-provider` 8 → 9, `openid-client` 5 → 6, and `koa` 2 → 3 (also `helmet` 8,
`pino` 10, `ejs` 6, `marked` 18, `nodemailer` 9, `koa-body` 8, `@koa/router` 15,
`uuid` 14). These are internal — the published container image bundles them, so a normal
chart upgrade needs no action. They matter only if you build a custom image or import
Passmower modules directly. The new behavioural test suite (unit + integration + e2e)
exists specifically to guard these upgrades.

---

## 7. What's new (non-breaking)

You don't have to do anything to get these, but they're the reason to upgrade:

- **Native OIDC clients** — `OIDCClient.spec.applicationType: native` for mobile/desktop
  apps that need custom-scheme or loopback redirect URIs (`web` remains the default).
- **Cross-device email login** — magic links can be opened on a different device/browser
  than the one that started the login.
- **Incognito impersonation links** — impersonate via a one-off link.
- **Secret-refresh alerting** — an opt-in `PrometheusRule` (`prometheusRule.enabled`)
  fires on failed secret-refresh Jobs via `kube_job_failed`; plus the existing
  `podMonitor.enabled` for scraping.
- **Security fixes** from the dependency/vulnerability sweep.
- **Pinned internal dev Redis image** (`redis.internal.image`, default `redis:7-alpine`)
  instead of the implicit `:latest`.

---

## 8. Upgrade

After editing your values (section 1) and any `OIDCClient`s that used
`secretRefreshPod` (section 2):

```sh
helm upgrade --install passmower \
  oci://ghcr.io/passmower/charts/passmower --version 2.0.0-dev \
  --set passmower.host=auth.your.domain \
  -f your-values.yaml
```

The chart templates the CRDs, so `helm upgrade` also updates the `OIDCClient` schema
(adding `secretRefreshJobSpec` and `applicationType`). Verify the rollout, then confirm
a login and — if you use them — that a client's secret-refresh Job runs.
