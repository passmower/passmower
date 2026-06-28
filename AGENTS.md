# AGENTS.md

Guidance for AI coding agents (and humans) working in the Passmower repo.
Read this before making changes — it captures the architecture, the conventions
this project follows, and the local-development story.

## What Passmower is

Passmower is a Kubernetes-native OIDC (OpenID Connect) Identity Provider built on
Node.js + Koa + [`oidc-provider`](https://github.com/panva/node-oidc-provider).
It does **not** replace your org IdP (GitHub, Google, EntraID, …) — it bridges
those upstreams into your Kubernetes ecosystem:

- **Users and enrolled applications are Kubernetes Custom Resources** (`OIDCUser`,
  `OIDCClient`, `OIDCMiddlewareClient`, all in group `codemowers.cloud/v1beta1`).
  Passmower is therefore also an **operator** — it watches these CRDs and reconciles.
- **Session/OIDC runtime state lives in Redis** (the `oidc-provider` storage adapter).
- **Upstream login** is via GitHub OAuth2, generic standards-compliant OIDC
  (Google/GitLab/EntraID/Dex/…), email magic-links, WebAuthn passkeys, and Slack.
- Applications are **auto-discovered** from `OIDCClient` CRDs across selected
  namespaces; legacy apps are supported via `Remote-*` forward-auth headers.

## Repo layout

```
src/
  app.js              # entrypoint; exports buildProvider() (wires everything, no listen)
  configuration.js    # oidc-provider configuration object (cookies, jwks, ttls, claims)
  adapters/           # redis.js (oidc storage), kubernetes.js (CRD + Secret + Job I/O)
  models/             # account.js, oidc-client.js, oidc-middleware-client.js (CRD <-> domain)
  operators/          # kube-*-operator.js — watch CRDs, reconcile to Redis/Secrets/status
  providers/          # setup-provider.js, setup-policies.js, setup-middlewares.js, ...
  conditions/         # predicate fns: approved, tosv1, claimed, username-committed
  routes/             # oidcRoutes, apiRoutes, adminRoutes, forwardAuthRoutes, metrics-server
  services/           # login/, session, webauthn, etc.
  utils/              # username, oidc-providers parsing, markdown, session helpers
  views/              # EJS templates
charts/passmower/     # Helm chart (CRDs, deployment, PodMonitor, PrometheusRule, values*)
test/                 # unit/, integration/, e2e/, fakes/, setup/, fixtures/
frontend/ styles/     # Vue frontend + SCSS (built into the image)
```

## Core patterns

- **App factory.** `buildProvider()` in `src/app.js` wires views/routes/policies and
  returns a fully-configured `oidc-provider` instance **without** calling `listen()`.
  `app.js` boots it; tests drive it via `supertest(provider.callback())`. Always
  reuse this factory rather than re-wiring a provider.
- **Interaction-based login.** The flow is `/auth` → `/interaction/:uid` (render a
  prompt) → POST the interaction → `provider.interactionFinished(...)` → token. Use
  `provider.interactionDetails`, `Interaction.find`, `provider.cookieName`. Policy
  prompts (`approval_required`, `tos`, `name`, `groups_required`) are defined in
  `src/providers/setup-policies.js` and gated by `src/conditions/*`.
- **Adapters are injectable seams.** `KubeOIDCClientOperator`, `KubeOidcUserOperator`,
  and `KubeOIDCUserService` take an optional adapter:
  `constructor(provider, adapter = new KubernetesAdapter())`. Tests inject
  `test/fakes/fake-kubernetes-adapter.js` (in-memory). Don't `new KubernetesAdapter()`
  deep inside logic — accept it.
- **Redis adapter is lazily connected.** Importing it must not open a socket or pin
  the event loop. Connection happens on first use / at boot; `disconnect()` drains the
  command queue before quit (used by test teardown — otherwise you get
  "Connection is closed" unhandled rejections in CI).
- **Kubernetes adapter chooses its kubeconfig:** `loadFromCluster()` when
  `KUBERNETES_SERVICE_HOST` is set, else `loadFromDefault()`; namespace falls back to
  `POD_NAMESPACE` / `default`. It exposes `CustomObjectsApi`, `CoreV1Api`, `BatchV1Api`.
- **Operator reconcile = CRD event → Redis/Secret/status.** Operators set watch
  parameters (mapper + added/modified/deleted callbacks) and react. The fake adapter's
  `fireWatch(type, kind, name)` drives synthetic events in tests.
- **Models map CRD spec ⇄ domain ⇄ Redis.** `fromIncomingClient` / `fromKubernetes`
  build from CRD objects; `toRedis()`, `toClientSecret()`, `getIntendedStatus()`,
  `claims()` produce the various projections. Owner references (`KubeOwnerMetadata`)
  tie created resources (Secrets, Jobs) to their CRD so they GC together.
- **`secretRefreshJobSpec` → a Job (not a Pod).** When a client wants its consuming
  workload restarted after its secret rotates, it sets `spec.secretRefreshJobSpec`
  (a `batch/v1` JobSpec). Passmower wraps it in a `Job` owned by the `OIDCClient`,
  defaults `restartPolicy: OnFailure` and `ttlSecondsAfterFinished: 3600`, and stamps
  `app.kubernetes.io/managed-by=passmower`, `app.kubernetes.io/component=secret-refresh`,
  `codemowers.cloud/oidc-client=<name>` labels so the shipped `PrometheusRule`
  (`prometheusRule.enabled`) can alert on `kube_job_failed`.

## Conventions established for this project

These are the working agreements — follow them:

- **Branch before editing; PR into `develop`, not `master`.** `master` is the stable
  `1.x` line; `develop` is the upcoming `2.0.0` line. All feature/fix work targets
  `develop` via a short-lived branch + PR. (PRs to `develop` don't auto-close issues
  since `master` is the default branch — close them manually, referencing the PR.)
- **Two release tracks, both driven by `Chart.yaml` `version`:**
  - push to `develop` → `docker-dev.yml` + `release-charts-dev.yml` publish the
    image and chart under the chart version (currently `2.0.0-dev`). No git tag/release.
  - push to `master` → `docker.yml` + `release-charts.yml` build the image, create a
    `v<version>` tag + GitHub release (pre-release if the version contains `-`), and
    publish the chart.
  - The deployment image tag **defaults to `.Chart.Version`**
    (`values.yaml: image.tag | default .Chart.Version`), so bumping `Chart.yaml` is the
    single source of truth for a release. Don't hardcode tags in the dev workflows —
    they derive `CHART_VERSION` from `Chart.yaml`.
- **Tests are the safety net for dependency upgrades.** The suite exists because major
  bumps (oidc-provider 8→9, openid-client 5→6) shipped with no behavioural coverage.
  Any dependency bump or behavioural change should keep `unit`, `integration`, and
  `e2e` green. Add a regression test when you fix a real bug.
- **Security-positive by default.** Clearing dependency vulns, not leaking cookies/
  tokens in logs, not weakening auth. Be conservative with anything that bypasses
  authentication (see the dev-login note below).
- **Match surrounding code** — comment density, naming, ESM imports. The frontend has
  its own ESLint config enforced in CI; the backend (`src/`) currently has none.

## Testing

```
npm test                 # unit project (fast, no services)
npm run test:integration # supertest + real Redis + fake kube + oauth2-mock-server
npm run test:e2e         # Playwright browser login against Dex (docker-compose.test.yml)
```

- **Unit** (`test/unit/**`): pure logic, fixtures only, no I/O.
- **Integration** (`test/integration/**`): drives the interaction login pattern through
  `supertest`, with a **real Redis** (set `REDIS_URI`), the **fake Kubernetes adapter**,
  and **`oauth2-mock-server`** as a standards-compliant upstream. Operator tests feed
  synthetic ADDED/MODIFIED/DELETED events via `adapter.fireWatch(...)`.
- **E2E** (`test/e2e/**` + `docker-compose.test.yml`): Playwright drives a full browser
  login through a real **Dex** upstream; a **Caddy** sidecar terminates TLS
  (`tls internal`) because the implicit flow and secure cookies require HTTPS.
- CI (`.github/workflows/test.yml`) runs all three on PRs to `develop`/`master`.

### Known gotchas (learned the hard way)

- `oidc-provider` v9: `instance(provider).configuration` is an **object**, not a
  function — `configuration('ttl.X')` is `configuration.ttl.X`.
- `ejs` 6 has **no named `renderFile` export** — `import ejs from "ejs"; const { renderFile } = ejs`.
- **Don't redact `set-cookie` via pino** response-header redaction paths — it rewrites
  the live `Set-Cookie` header to `[Redacted]` on the wire and breaks every login.
- `end_session` reads `ctx.cookies`, not `ctx.oidc.cookies` (set both if shimming).
- `base-domain` must guard IP/`localhost` hosts (no public suffix → return the hostname).

## Local development

Passmower assumes a cluster (it's an operator) and **assumes real HTTPS**. Two pieces
make local dev work: a cluster to run in, and a way to log in without provisioning real
email/GitHub credentials.

### Cluster: minikube + Skaffold

A `skaffold.yaml` dev profile already exists — it builds the `dev` image target, syncs
`src/`, `frontend/src/`, `styles/src/` into the running pod, and `helm install`s the
chart with `charts/passmower/values.dev.yaml`.

```
minikube start
minikube addons enable ingress          # ingress-nginx
skaffold dev                            # build + sync + deploy + tail logs (profile: dev)
```

> **Real HTTPS ingress is required, not optional.** Passmower issues secure cookies,
> the OIDC implicit flow needs `https`, and `web`-type clients require `https` redirect
> URIs. A plain `http://` minikube ingress or a self-signed cert that browsers/clients
> reject will produce confusing login failures. Use a real DNS name with a real
> certificate:
> - the lowest-friction option for a local minikube is the
>   [Cloudflare Tunnel ingress controller](https://github.com/STRRL/cloudflare-tunnel-ingress-controller):
>   it exposes your in-cluster `Ingress` over a Cloudflare Tunnel on a real public
>   hostname with a real (Cloudflare-terminated) TLS cert, with no port-forwarding,
>   public IP, or DNS-01 plumbing — just a `Tunnel`/`Ingress` annotation, **or**
> - point a real hostname at the minikube ingress IP and issue a cert with
>   **cert-manager** (Let's Encrypt DNS-01), **or**
> - terminate TLS with a trusted cert in front (the e2e setup uses **Caddy
>   `tls internal`** + trusting its CA as a pattern you can copy locally).
>
> Set `ISSUER_URL` to that `https://…/` host (note the **trailing slash** — it is
> concatenated directly, e.g. `${ISSUER_URL}interaction/callback/gh`).

### Login without real email/GitHub — Dex as a stub upstream

For developing apps **against** Passmower (e.g. driftmower), devs shouldn't need to set
up SMTP or a GitHub OAuth app just to sign in. The dev login path is **Dex** configured
as a stub upstream — no Passmower code change, and it exercises the real login plumbing.

Run [Dex](https://dexidp.io/) in-cluster with a **static connector + static
passwords** (or the `mockCallback` connector), and point Passmower at it via
`OIDC_PROVIDERS`:

```yaml
passmower:
  oidcProviders:
    - key: dev
      displayName: Dev login (Dex)
      issuer: https://dex.dev.local        # or http:// if OIDC_ALLOW_INSECURE_UPSTREAM=true
      clientSecretRef: dex-dev-client
```

Set `OIDC_ALLOW_INSECURE_UPSTREAM=true` to permit an `http://` Dex during local dev.
This exercises the **real** `openid-client` v6 discovery + PKCE + JWKS path, so it's
also the most production-faithful local login — and it's exactly what the e2e suite
already stands up, so the Dex config there is a working reference.

> Don't add an authentication bypass (a "dev login" that mints an identity with no
> upstream) to Passmower itself — keep the auth path real and route dev logins through
> Dex.

### Running pieces directly

```
npm run dev            # nodemon, src/app.js with --inspect (needs env: ISSUER_URL,
                       # OIDC_COOKIE_KEYS, OIDC_JWKS, REDIS_URI, a reachable kube context)
npm run dev-frontend   # Vue dev server
npm run dev-styles     # SCSS watch
```

## Configuration / environment

The chart maps `values.passmower.*` to env vars. The ones that matter most:

| Env | Purpose |
|---|---|
| `ISSUER_URL` | Public base URL of Passmower, **with trailing slash**. |
| `OIDC_COOKIE_KEYS` | JSON array of cookie-signing keys. |
| `OIDC_JWKS` | JSON JWKS for token signing. |
| `REDIS_URI`, `REDIS_IP_FAMILY` | Redis connection. |
| `OIDC_PROVIDERS` | JSON array of generic upstream OIDC providers. |
| `OIDC_ALLOW_INSECURE_UPSTREAM` | Permit `http://` upstreams (local dev only). |
| `GITHUB_ENABLED`, `GH_CLIENT_ID/SECRET`, `GITHUB_ORGANIZATION` | GitHub upstream. |
| `EMAIL_ENABLED`, `EMAIL_HOST/PORT/SSL/USERNAME/PASSWORD/FROM` | Email magic-links. |
| `WEBAUTHN_ENABLED`, `WEBAUTHN_RP_NAME` | Passkeys. |
| `SLACK_TOKEN` | Slack integration. |
| `GROUP_PREFIX`, `ADMIN_GROUP`, `REQUIRED_GROUP` | Group/authorization policy. |
| `ENROLL_USERS`, `USERNAME_SOURCE`, `REQUIRE_CUSTOM_USERNAME`, `USE_GITHUB_USERNAME` | Enrollment / username policy (see `docs/username-configuration.md`). |
| `PREFERRED_EMAIL_DOMAIN`, `NORMALIZE_EMAIL_ADDRESSES` | Email handling. |
| `NAMESPACE_SELECTOR` | Which namespaces to watch for client CRDs. |
| `DISABLE_FRONTEND_EDIT` | Enforce GitOps (no profile/admin edits). |
| `KUBERNETES_SERVICE_HOST`, `POD_NAMESPACE` | Set in-cluster; switch kubeconfig/namespace behaviour. |

See also: `README.md` (install + upstream config), `docs/application-listing.md`,
`docs/username-configuration.md`.
