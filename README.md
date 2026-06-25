# Passmower authorization server

[![License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

## Overview

Passmower is Node.js-based OIDC (OpenID Connect) Identity Provider that is
designed for Kubernetes environments.
It seamlessly integrates with Kubernetes, persisting its data, including users
and enrolled applications, using Kubernetes Custom Resource Definitions (CRD)
while storing session data in Redis.
Passmower does not aim to replace your existing organizational
IdP (Azure, Okta, GitHub etc), but to rather gap the bridge between that and
rest of your Kubernetes ecosystem.

Passmower automatically discovers applications from the Kubernetes API and
supports dynamic enrollment and removal of applications.
It also provides out-of-the-box impersonation support for authorized users.

## Features

- **Kubernetes Integration**: The OIDC Identity Provider is tailored for Kubernetes environments, offering a seamless way to manage authentication and authorization within the cluster.

- **CRD Data Persistence**: All user data, as well as enrolled applications, are persisted in Kubernetes Custom Resource Definitions (CRD), ensuring a scalable and Kubernetes-native way of managing the identity provider's state.

- **Redis Session Storage**: Session data is stored in Redis, guaranteeing efficient and reliable management of user sessions.

- **Automatic Application Discovery**: The OIDC Identity Provider automatically discovers supported applications deployed in the Kubernetes cluster, allowing for dynamic enrollment and removal of these applications.

- **Impersonation Support**: The identity provider provides out-of-the-box impersonation support, enabling authorized users to impersonate other users or service accounts.

- **Legacy Application Support**: Legacy applications are supported via the `Remote-*` header middleware option, which uses the forwardAuth protocol used by Traefik.

- **Upstream Identity Sources**: The OIDC Identity Provider supports multiple upstream identity sources, including GitHub OAuth2, standards-compliant OIDC providers (Google, GitLab, Microsoft EntraID), magic links via email, and Slack bot integration.

## Supported Applications

Passmower has been tested and supports the following applications:

- [Nextcloud](https://git.k-space.ee/k-space/kube/src/branch/master/nextcloud/)
- [Freescout](https://git.k-space.ee/k-space/kube/src/branch/master/freescout/)
- [Gitea](https://git.k-space.ee/k-space/kube/src/branch/master/gitea/)
- [Grafana](https://git.k-space.ee/k-space/kube/src/branch/master/grafana/)
- [Wikijs](https://git.k-space.ee/k-space/kube/src/branch/master/wiki/)
- [Kubernetes API itself](https://git.k-space.ee/k-space/kube/src/branch/master/passmower/kubelogin.yaml)
- [Proxmox](https://git.k-space.ee/k-space/kube/src/branch/master/passmower/proxmox.yaml) 7.4 or later
- [ArgoCD](https://git.k-space.ee/k-space/kube/src/branch/master/argocd/)
- [Matrix](https://matrix.org/)
- [MemeLord](https://github.com/l4rm4nd/MemeLord)

# Installation

Install using helm from ghcr.io, **at least set the hostname**:

```
helm install passmower oci://ghcr.io/passmower/charts/passmower --version 1.2.0 --set passmower.host=auth.your.domain
```

Note we commend installing Passmower declaratively either by using
[ArgoCD](https://argo-cd.readthedocs.io/en/stable/) or
[Rancher Helm Controller](https://github.com/k3s-io/helm-controller)

```
---
apiVersion: helm.cattle.io/v1
kind: HelmChart
metadata:
  name: passmower
  namespace: kube-system
spec:
  bootstrap: true
  version: 1.2.0
  chart: oci://ghcr.io/passmower/charts/passmower
  createNamespace: true
  failurePolicy: reinstall
  targetNamespace: passmower
  valuesContent: |-
    passmower:
      host: auth.example.com
```

See and use [values.yaml](values.yaml) for customizations.

## Upstream login providers

Passmower authenticates users against GitHub (a dedicated handler), email
magic-links, and any number of **standards-compliant OIDC providers** through a
single generic connector (discovery + PKCE + `id_token` validation). Users are
linked across providers by verified email.

OIDC providers are configured entirely at deploy time — adding Google, GitLab,
EntraID, Keycloak, Okta, Authentik, Zitadel, etc. requires no code change, just
a `passmower.oidcProviders` list entry:

```yaml
passmower:
  oidcProviders:
    - key: google                       # slug; also the callback path & env prefix
      displayName: Google                # label on the sign-in button
      issuer: https://accounts.google.com
      clientSecretRef: google-client     # k8s secret with GOOGLE_CLIENT_ID/SECRET
    - key: gitlab
      displayName: GitLab
      issuer: https://gitlab.com         # set your host for self-hosted GitLab
      groupsClaim: groups_direct         # token claim to read groups from
      groupPrefix: gitlab.com            # optional; defaults to the issuer host
      clientSecretRef: gitlab-client
    - key: entraid
      displayName: Microsoft
      issuer: https://login.microsoftonline.com/<tenant-id>/v2.0
      groupsClaim: groups
      groupPrefix: entraid
      clientSecretRef: entraid-client
```

Each entry supports: `key` (required), `displayName`, `issuer` (required),
`scopes` (defaults to `[openid, email, profile]`), `groupsClaim`, `groupPrefix`,
`enabled` (defaults to `true`), and `clientSecretRef`.

**Credentials** are never placed in values. The referenced Kubernetes secret
must contain `<KEY>_CLIENT_ID` and `<KEY>_CLIENT_SECRET`, where `<KEY>` is the
provider key upper-cased with non-alphanumerics replaced by `_` (e.g. key
`google` → `GOOGLE_CLIENT_ID`, key `entra-id` → `ENTRA_ID_CLIENT_ID`). Several
providers may share one secret. A provider only appears on the sign-in page once
its credentials are present.

When registering the OAuth/OIDC application with each provider, set the redirect
(callback) URI to:

```
https://<your-passmower-host>/interaction/callback/<key>
```

**Group/role sync:** when `groupsClaim` is set, its values are mapped into the
user's groups with `groupPrefix`. EntraID may emit group **object IDs** unless
the app manifest is configured to emit group names; Google personal accounts do
not expose groups over OIDC. Synced upstream groups are read-only in the UI;
only locally-created groups (under `GROUP_PREFIX`) are editable.

Federated identities are persisted on the `OIDCUser` resource under the
`identities.<key>` map.


# Usage

## Application enrollment

Once Passmower is successfully deployed, you can begin using
it to manage authentication and authorization for your Kubernetes applications
and supported services.

Passmower automatically discovers applications running within
the Kubernetes cluster. To enroll a supported application for OIDC-based
authentication, you can use the following Kubernetes manifest:

```
---
apiVersion: codemowers.cloud/v1beta1
kind: OIDCClient
metadata:
  name: grafana
spec:
  displayName: Grafana
  uri: https://grafana.example.com
  redirectUris:
    - https://grafana.example.com/login/generic_oauth
  allowedGroups:
    - github.com:example-org:grafana-users-team
    - yourorg.com:local-group
  grantTypes:
    - authorization_code
    - refresh_token
  responseTypes:
    - code
  availableScopes:
    - openid
    - profile
  tokenEndpointAuthMethod: none
```

Make sure to replace the `redirectURI` with the correct callback URL for your
application. Secret named `oidc-client-grafana-owner-secrets` is written
into the originating namespace.

In most cases application deployment can directly read the generated secret:

```
env:
  - name: GF_AUTH_GENERIC_OAUTH_CLIENT_ID
    valueFrom:
      secretKeyRef:
        name: oidc-client-grafana-owner-secrets
        key: OIDC_CLIENT_ID
  - name: GF_AUTH_GENERIC_OAUTH_SECRET
    valueFrom:
      secretKeyRef:
        name: oidc-client-grafana-owner-secrets
        key: OIDC_CLIENT_SECRET
  - name: GF_AUTH_GENERIC_OAUTH_AUTH_URL
    valueFrom:
      secretKeyRef:
        name: oidc-client-grafana-owner-secrets
        key: OIDC_GATEWAY_AUTH_URI
```

To list applications:

```
kubectl get oidcclients --all-namespaces -o json | jq -r '.items[] | [.metadata.namespace, .metadata.name, .spec.uri] | @tsv' | column -t
```

### Customizing the generated secret

Use `spec.secretMetadata` to add labels and annotations to the generated
`oidc-client-<name>-owner-secrets` secret. This is useful when another
controller needs specific metadata to pick up the secret — for example, ArgoCD
requires the `app.kubernetes.io/part-of: argocd` label to read it:

```
apiVersion: codemowers.cloud/v1beta1
kind: OIDCClient
metadata:
  name: grafana
spec:
  # ... other fields ...
  secretMetadata:
    labels:
      app.kubernetes.io/part-of: argocd
    annotations:
      example.com/some-annotation: 'value'
```

Both `labels` and `annotations` are optional and are reconciled onto the secret
on every change to the `OIDCClient`.

## User enrollment

If automatic enrollment is disabled users can be managed GitOps style.

```
apiVersion: codemowers.cloud/v1beta1
kind: OIDCUser
metadata:
  name: johnsmith
spec:
  companyEmail: johnsmith@example.com
  groups:
  - name: kubernetes:admins
    prefix: example.com
  type: person
```

To list users:

```
kubectl get oidcusers --all-namespaces -o json | jq -r '.items[] | select(.spec.type=="person") | [.metadata.name, .spec.companyEmail // "-", .status.slackId // "-", .github.id // "-", .status.profile.name] | @tsv' | column -t
```

## Traefik middleware

For legacy applications `forwardAuth` based middleware option is supported.

```
---
apiVersion: codemowers.cloud/v1beta1
kind: OIDCMiddlewareClient
metadata:
  name: webmail
spec:
  displayName: Webmail
  uri: 'https://webmail.example.com'
  allowedGroups:
    - example.com:employees
  headerMapping:
    email: Remote-Email
    groups: Remote-Groups
    name: Remote-Name
    user: Remote-User
```

For the ingress refer to automatically created middleware
`traefik.ingress.kubernetes.io/router.middlewares: namespace-webmail@kubernetescrd`


# Contributing

We welcome contributions to enhance the functionality and features of Passmower.
If you find any issues or have suggestions for improvement,
please open an issue or submit a pull request.

# License

Passmower is licensed under the MIT License.
