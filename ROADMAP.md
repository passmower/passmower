# Roadmap

This document describes planned and in-progress work for Passmower.
Dates are targets, not commitments. Priorities shift based on contributor availability and user feedback.
Open a GitHub issue or comment on an existing one to influence prioritisation.

## Released

### 2.0 (2024)
- Helm values renamed to camelCase
- `OIDCClient` secret-refresh field changed
- Migration guide: [docs/migrating-to-2.0.md](docs/migrating-to-2.0.md)

### 2.x (ongoing)
- High-availability mode with leader-elected reconciler ([docs/high-availability.md](docs/high-availability.md))
- SCIM 2.0 provisioning endpoint ([docs/scim-provisioning.md](docs/scim-provisioning.md))
- Kubernetes-native user lifecycle hooks ([docs/oidc-user-event-hooks.md](docs/oidc-user-event-hooks.md))
- Application listing API (`/api/apps/all`, `applications` userinfo claim)
- Proxmox 7.4+ support

## Near-term (next 1–2 releases)

- **Password-based login** ([#290](https://github.com/passmower/passmower/issues/290)) — opt-in local credentials for environments without an upstream IdP
- **Usage metrics** ([#feat/issue-50](https://github.com/passmower/passmower/pull)) — Prometheus metrics for active sessions, enrolled apps, and user counts
- **Improved forwardAuth middleware** ([#40](https://github.com/passmower/passmower/issues/40)) — generalise the Traefik middleware pattern to other reverse proxies
- **Chart: restricted Pod security** — helm chart compliant with `restricted` Pod Security Standard

## Medium-term

- **User offboarding** ([#73](https://github.com/passmower/passmower/issues/73)) — automated revocation of sessions, group memberships, and downstream app access on user removal
- **Cluster-scoped users** ([#55](https://github.com/passmower/passmower/issues/55)) — single user CRD visible across namespaces without namespace-per-tenant duplication
- **SSH key management** ([#56](https://github.com/passmower/passmower/issues/56)) — store and surface user SSH public keys via the API for use in Gitea, Proxmox, and similar
- **LDAP read-only service** ([#28](https://github.com/passmower/passmower/issues/28)) — expose a read-only LDAP interface for legacy applications that cannot use OIDC
- **Slack notification and approval workflows** ([#17](https://github.com/passmower/passmower/issues/17)) — group join requests and admin approvals via Slack bot

## CNCF sandbox

Passmower is pursuing [CNCF sandbox](https://github.com/cncf/sandbox) acceptance.
The outstanding prerequisites before the application is filed:

- [ ] Recruit ≥1 maintainer from a second employer (see [MAINTAINERS.md](MAINTAINERS.md))
- [x] `CODE_OF_CONDUCT.md` — CNCF Code of Conduct adopted
- [x] `CONTRIBUTING.md` — contribution and local-dev guide
- [x] `ADOPTERS.md` — known production users
- [ ] TAG Security self-assessment

## How to contribute

See [CONTRIBUTING.md](CONTRIBUTING.md) for the local development setup, test commands, and PR guidelines.
