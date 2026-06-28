# Migrating from Passmower 1.x to 2.0

Passmower 2.0 is a major release. It carries two consumer-facing breaking changes
(Helm values and one `OIDCClient` CRD field) plus a sweep of major dependency
upgrades. This note lists everything you must change, and what changed for the better.

> The 2.0 line ships from the `develop` branch as `2.0.0-dev` (image
> `ghcr.io/passmower/passmower:2.0.0-dev`, chart
> `oci://ghcr.io/passmower/charts/passmower --version 2.0.0-dev`) until `2.0.0` is
> cut on `master`. Use it on non-production / dev clusters first.

## Before you start

- Back up your `values.yaml` (or HelmRelease/ArgoCD Application values).
- Back up your `OIDCClient` and `OIDCUser` custom resources:
  `kubectl get oidcclients,oidcusers,oidcmiddlewareclients -A -o yaml > passmower-crs.bak.yaml`.
- Read the two **action required** sections below and edit your values / CRs before
  upgrading.

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
`USERNAME_SOURCE`, …), so if you inject configuration directly as env vars rather than
through chart values, nothing changes for you.

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
```

Passmower still owns the resulting Job (owner-referenced to the `OIDCClient`, so it is
garbage-collected with it) and stamps it with `app.kubernetes.io/managed-by=passmower`,
`app.kubernetes.io/component=secret-refresh`, and `codemowers.cloud/oidc-client=<name>`
labels.

> A leftover `secretRefreshPod` field on an existing `OIDCClient` is simply ignored by
> 2.0 — the refresh hook silently stops running until you migrate it to
> `secretRefreshJobSpec`.

---

## 3. RBAC change — automatic

The chart's `ClusterRole` now grants `create` on `batch/jobs` instead of core `pods`
(the operator creates the refresh **Job** described above). This is applied for you by
`helm upgrade`. You only need to act if you manage Passmower's RBAC out of band (e.g. a
hand-maintained `ClusterRole`): grant `create` on `jobs` in the `batch` API group, and
you may drop the old `pods` `create` grant.

---

## 4. Major dependency upgrades — informational

2.0 upgrades several runtime dependencies across major versions, most notably
`oidc-provider` 8 → 9, `openid-client` 5 → 6, and `koa` 2 → 3 (also `helmet` 8,
`pino` 10, `ejs` 6, `marked` 18, `nodemailer` 9, `koa-body` 8, `@koa/router` 15,
`uuid` 14). These are internal — the published container image bundles them, so a normal
chart upgrade needs no action. They matter only if you build a custom image or import
Passmower modules directly. The new behavioural test suite (unit + integration + e2e)
exists specifically to guard these upgrades.

---

## 5. What's new (non-breaking)

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

## 6. Upgrade

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
