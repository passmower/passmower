# Enrolling applications from Ingress annotations

Applications are normally enrolled by writing an `OIDCClient`. Passmower can
also derive one from annotations on an `Ingress`, the way Traefik and
external-dns are configured, so an application that already declares its
hostname and path in an Ingress does not have to repeat them.

Off by default, because it creates resources and needs cluster read on
Ingresses, which the chart grants only when it is on:

```yaml
passmower:
  ingressDiscovery:
    enabled: true
```

## Annotating an Ingress

```yaml
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: grafana
  namespace: apps
  annotations:
    codemowers.io/oidc-display-name: Grafana
    codemowers.io/oidc-redirect-path: /login/generic_oauth
    codemowers.io/oidc-allowed-groups: k-space:floor,k-space:foobar
spec:
  rules:
    - host: grafana.example.com
      http:
        paths: [...]
```

Passmower creates an `OIDCClient` named after the Ingress, in the same
namespace, owned by it:

```yaml
apiVersion: codemowers.cloud/v1
kind: OIDCClient
metadata:
  name: grafana
  namespace: apps
  labels:
    app.kubernetes.io/managed-by: passmower
    codemowers.cloud/discovered-from: Ingress.grafana
  ownerReferences:
    - apiVersion: networking.k8s.io/v1
      kind: Ingress
      name: grafana
spec:
  displayName: Grafana
  uri: https://grafana.example.com/
  redirectUris:
    - https://grafana.example.com/login/generic_oauth
  grantTypes: ['authorization_code']
  responseTypes: ['code']
  availableScopes: ['openid']
  allowedGroups: ['k-space:floor', 'k-space:foobar']
```

From there nothing is special: the client operator generates the Secret,
registers the client, reports `Ready`, and lists the application in the
launcher exactly as it does for a hand-written one. The generated resource is
also the answer to "what did discovery actually make?" — read it with
`kubectl get oidcclient`.

## Annotations

| Annotation | Maps to | Default |
|---|---|---|
| `codemowers.io/oidc-redirect-path` | `redirectUris`, resolved against the host | **required** |
| `codemowers.io/oidc-display-name` | `displayName` | the Ingress name |
| `codemowers.io/oidc-allowed-groups` | `allowedGroups` | unset (everyone) |
| `codemowers.io/oidc-allowed-users` | `allowedUsers` | unset |
| `codemowers.io/oidc-available-scopes` | `availableScopes` | `openid` |
| `codemowers.io/oidc-grant-types` | `grantTypes` | `authorization_code` |
| `codemowers.io/oidc-response-types` | `responseTypes` | `code` |

All list-valued annotations are comma-separated. `uri` comes from the Ingress
host, so it is never annotated.

## Rules

- **Any `codemowers.io/oidc-*` annotation asks for discovery.** Keying off the
  whole prefix rather than one required annotation means a mistyped annotation
  gets a complaint on the Ingress instead of doing nothing quietly.
- **One host.** An Ingress with several hosts in `spec.rules` is refused rather
  than resolved — which host an application authenticates on is not a good thing
  to guess at. Split it, or write the `OIDCClient` by hand.
- **A hand-written client wins.** If an `OIDCClient` of that name already exists
  and did not come from this Ingress, it is left untouched and the conflict is
  reported. The resource in Git is authoritative; an annotation does not rewrite
  it from the side.
- **Removing the annotations removes the client.** Deleting the Ingress does too,
  through the ownerReference.
- **`NAMESPACE_SELECTOR` applies**, exactly as it does to `OIDCClient`
  resources: without it, only Ingresses in Passmower's own namespace are seen.

## What it reports

Everything discovery decides shows up as an event on the Ingress, which is
where whoever wrote the annotation will look:

```console
$ kubectl describe ingress grafana
...
Events:
  Type     Reason                    Message
  Normal   OIDCClientDiscovered      Created OIDCClient grafana for https://grafana.example.com/
```

| Reason | Meaning |
|---|---|
| `OIDCClientDiscovered` | client created or updated from the annotations |
| `OIDCClientRemoved` | annotations gone, generated client withdrawn |
| `OIDCClientConflict` | a client of that name exists and is not ours to manage |
| `IngressDiscoveryFailed` | the annotations do not describe a client — the message says why |

## When to write the OIDCClient instead

Discovery covers the common shape: one host, one or more redirect paths, group
or user allowlists. Anything else — `secretRefreshJobSpec`, `claimMappings`,
`allowedCORSOrigins`, `pkce`, `displayOrder`, a client whose redirect URI is not
on its own Ingress host, or a native application with a custom-scheme redirect —
is a reason to write the `OIDCClient` directly. The two can coexist in one
cluster; they are the same resource in the end.
