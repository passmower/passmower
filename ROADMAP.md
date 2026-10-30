# Roadmap

This document lists the work Passmower is considering next. It is not a
schedule: each item is tracked in a GitHub issue, and the issue is where the
design is discussed and priorities are set. Comment there to influence it.

For what has already shipped, see the
[releases](https://github.com/passmower/passmower/releases) and the
[documentation](docs/). Upgrading from 1.x is covered in
[docs/migrating-to-2.0.md](docs/migrating-to-2.0.md).

## In progress

- **Password-based login** ([#290](https://github.com/passmower/passmower/issues/290)):
  local credentials for installations without an upstream identity provider.
  The first step is a `kubectl`-based command line tool for managing users,
  passwords and group membership; server-side support follows.

## Proposed

These have an issue but no agreed design yet.

### Identity lifecycle

- **User offboarding** ([#73](https://github.com/passmower/passmower/issues/73)):
  disable a user before removing them, with downstream resources disabled,
  transferred or deleted along the way, for example to fulfil GDPR requests.
- **Cluster-scoped users** ([#55](https://github.com/passmower/passmower/issues/55)):
  a cluster-scoped `OIDCUser`, so resources created for a user can carry an
  owner reference to it and are cleaned up when the user is deleted.
- **Service account mapping** ([#317](https://github.com/passmower/passmower/issues/317)):
  map a service-type `OIDCUser` to a Kubernetes service account subject,
  `system:serviceaccount:<namespace>:<name>`.
- **User profile page** ([#318](https://github.com/passmower/passmower/issues/318)):
  a page per user that OIDC subjects shown in applications can link to.
- **SSH key management** ([#56](https://github.com/passmower/passmower/issues/56)):
  SSH public keys in a claim, synced from the upstream provider or added locally,
  and served from a `<username>.keys` endpoint.

### Login and session security

- **PKCS#15 login** ([#316](https://github.com/passmower/passmower/issues/316)):
  smart-card login for air-gapped installations, possibly as a separate
  component acting as an upstream for Passmower.
- **Geo-locked sessions** ([#315](https://github.com/passmower/passmower/issues/315)):
  reject requests and token refreshes made with a valid session from outside the
  user's allowed countries.
- **Slack login** ([#17](https://github.com/passmower/passmower/issues/17)):
  sign in with Slack OAuth. Slack IDs on users and magic-link messages in Slack
  are already implemented.

### Application integration

- **Generalised forwardAuth middleware** ([#40](https://github.com/passmower/passmower/issues/40)):
  make the middleware and the OIDC secret independently optional on an
  application, so the same resource can protect an OIDC-native application or
  just add a link to the application listing.
- **Sidecar authentication proxy** ([#27](https://github.com/passmower/passmower/issues/27)):
  protect a workload with an authenticating proxy container in its pod instead of
  an ingress middleware.
- **Application listing templating** ([#53](https://github.com/passmower/passmower/issues/53)):
  icons, descriptions and links such as issue trackers or dashboards for each
  application, configured in a ConfigMap.
- **Read-only LDAP service** ([#28](https://github.com/passmower/passmower/issues/28)):
  an LDAP interface for applications that support nothing else.

## CNCF sandbox

Passmower intends to apply to the [CNCF sandbox](https://github.com/cncf/sandbox).
Status of the preparation:

- [x] Maintainers from more than one organisation ([MAINTAINERS.md](MAINTAINERS.md))
- [x] [Code of conduct](CODE_OF_CONDUCT.md)
- [x] [Contribution guide](CONTRIBUTING.md)
- [x] [Adopters](ADOPTERS.md)
- [ ] TAG Security self-assessment

## How to contribute

See [CONTRIBUTING.md](CONTRIBUTING.md) for the local development setup, test
commands and pull request guidelines.
