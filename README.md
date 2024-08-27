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

- **Upstream Identity Sources**: The OIDC Identity Provider supports multiple upstream identity sources, including GitHub OAuth2, magic links via email, and Slack bot integration.

## Supported Applications

Passmower has been tested and supports the following applications:

- [Nextcloud](https://git.k-space.ee/k-space/kube/src/branch/master/nextcloud/application.yaml)
- [Freescout](https://git.k-space.ee/k-space/kube/src/branch/master/freescout/application.yml)
- [Gitea](https://git.k-space.ee/k-space/kube/src/branch/master/gitea/application.yaml)
- [Grafana](https://git.k-space.ee/k-space/kube/src/branch/master/grafana/application.yml)
- [Wikijs](https://git.k-space.ee/k-space/kube/src/branch/master/wiki/application.yml)
- [Kubernetes API itself](https://git.k-space.ee/k-space/kube/src/branch/master/oidc-gateway/kubelogin.yaml)
- [Proxmox](https://git.k-space.ee/k-space/kube/src/branch/master/oidc-gateway/proxmox.yaml) 7.4 or later
- [ArgoCD](https://git.k-space.ee/k-space/kube/src/branch/master/argocd/application-extras.yml)

# Installation

Install using helm from ghcr.io, **at least setting the hostname**: `helm install passmower oci://ghcr.io/passmower/charts/passmower --version 1.0.0 --set passmower.host=auth.your.domain`

See and use [values.yaml](values.yaml) for customizations.


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
apiVersion: codemowers.io/v1alpha1
kind: OIDCGWClient
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
kubectl get oidcgatewayclients --all-namespaces -o json | jq -r '.items[] | [.metadata.namespace, .metadata.name, .spec.uri] | @tsv' | column -t
```

## User enrollment

If automatic enrollment is disabled users can be managed GitOps style.

```
apiVersion: codemowers.io/v1alpha1
kind: OIDCGWUser
metadata:
  name: johnsmith
spec:
  companyEmail: johnsmith@example.com
  customGroups:
  - name: kubernetes:admins
    prefix: example.com
  customProfile:
    name: John Smith
  email: johnsmith@gmail.com
```

To list users:

```
kubectl get oidcgatewayusers --all-namespaces -o json | jq -r '.items[] | select(.spec.type=="person") | [.metadata.name, .spec.companyEmail // "-", .status.slackId // "-", .spec.githubProfile.id // "-", .status.profile.name] | @tsv' | column -t
```

## Traefik middleware

For legacy applications `forwardAuth` based middleware option is supported.

```
---
apiVersion: codemowers.io/v1alpha1
kind: OIDCGWMiddlewareClient
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
    user: Remote-Username
```

For the ingress refer to automatically created middleware
`traefik.ingress.kubernetes.io/router.middlewares: namespace-webmail@kubernetescrd`


# Contributing

We welcome contributions to enhance the functionality and features of Passmower.
If you find any issues or have suggestions for improvement,
please open an issue or submit a pull request.

# License

Passmower is licensed under the MIT License.
