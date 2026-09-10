# Ingress integration

An application that already declares its hostname in an `Ingress` should not
have to repeat it in its `OIDCClient`. There are two ways not to, both off
unless `passmower.ingressDiscovery.enabled` is set:

- **[Annotations on the Ingress](#annotating-an-ingress)** derive the whole
  client, the way Traefik and external-dns are configured — no `OIDCClient` to
  write at all.
- **[`ingressRef` on the OIDCClient](#taking-the-host-from-an-ingress-ingressref)**
  keeps the client hand-written but reads the host from an Ingress.

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

## Taking the host from an Ingress (`ingressRef`)

The other direction: keep writing the `OIDCClient` by hand, but read the host
from an Ingress instead of repeating it.

```yaml
apiVersion: codemowers.cloud/v1
kind: OIDCClient
metadata:
  name: grafana
  namespace: apps
spec:
  displayName: Grafana
  grantTypes: ['authorization_code']
  responseTypes: ['code']
  availableScopes: ['openid', 'profile', 'email']
  ingressRef:
    name: grafana
  redirectPaths:
    - /login/generic_oauth
```

`uri` and `redirectUris` are resolved from the referenced Ingress' host plus
`redirectPaths`, and are **not written back into the resource** — the operator
reports them in status instead, so a GitOps tool sees no drift on a resource it
owns:

```console
$ kubectl -n apps get oidcclient grafana -o jsonpath='{.status.resolvedUri}'
https://grafana.example.com/
```

Set either `redirectUris` **or** `ingressRef` with `redirectPaths` — the CRD
rejects both together and neither at all:

```
The OIDCClient "grafana" is invalid: spec: Invalid value: set either
redirectUris, or ingressRef with redirectPaths — not both and not neither
```

Rules, mostly the same as for annotation discovery:

- **Same namespace only.** `ingressRef` has no `namespace` field, deliberately:
  pointing at another namespace's Ingress would let a client claim a hostname it
  does not own.
- **One host**, for the same reason discovery refuses several.
- **Requires `passmower.ingressDiscovery.enabled`**, which is what grants Ingress
  read. Without it the client reports
  `Ready=False IngressRefUnresolved` naming the setting.
- **A missing or unusable Ingress is refused, not guessed at**: registering a
  client with no redirect URI would fail logins with a mismatch, which is much
  harder to place than a condition saying `the referenced Ingress does not
  exist`.
- **A renamed host takes effect immediately.** Renaming the Ingress host does not
  touch the client, so nothing about the client changes and its reconcile
  fingerprint is unmoved; the Ingress watch asks the client operator to
  reconcile it anyway, and the resolved values follow within a second.

> **All Passmower instances watching the namespace must be 2.4.0 or newer.**
> `ingressRef` clients have no `spec.redirectUris`, and an older instance
> requires that field — it fails their reconcile with
> `Ready=False ReconcileFailed: Cannot read properties of undefined (reading
> 'join')`. This matters where two instances watch the same namespaces (see
> `NAMESPACE_SELECTOR`): upgrade them together, or the older one will keep
> claiming such clients and failing them.

## When to write the OIDCClient instead

Annotation discovery covers the common shape: one host, one or more redirect
paths, group or user allowlists — and `ingressRef` covers the case where the
client is hand-written but its host should not be duplicated. Anything else — `secretRefreshJobSpec`, `claimMappings`,
`allowedCORSOrigins`, `pkce`, `displayOrder`, a client whose redirect URI is not
on its own Ingress host, or a native application with a custom-scheme redirect —
is a reason to write the `OIDCClient` directly. The two can coexist in one
cluster; they are the same resource in the end.
