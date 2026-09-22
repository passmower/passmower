# API scopes

Passmower serves a fixed set of scopes of its own — `openid`, `email`,
`profile`, `offline_access`, `groups`, `allowed_groups`, `applications`,
`all_applications`, `namespaces`. They describe the *user*, and they are the
same for every client.

An application that exposes an API needs something else: scopes that describe
what a caller may do *to that API*, in the application's own naming —
`gallery:images:read`, `gallery:boards:write`. Those belong to the application,
not to Passmower, so `OIDCClient.spec.availableScopes` accepts any
[RFC 6749](https://www.rfc-editor.org/rfc/rfc6749#section-3.3) scope token
rather than a fixed list. Onboarding an API is editing its `OIDCClient`, not
changing Passmower.

```yaml
apiVersion: codemowers.cloud/v1
kind: OIDCClient
metadata:
  name: gallery
  namespace: apps
spec:
  displayName: Gallery
  uri: https://gallery.example.com
  redirectUris:
    - https://gallery.example.com/auth/login
  grantTypes: ['authorization_code']
  responseTypes: ['code']
  availableScopes:
    - openid
    - profile
    - gallery:images:read
    - gallery:images:write
```

## How a client asks for one

An API scope only means something in relation to an API, so the client names
that API with an [RFC 8707](https://www.rfc-editor.org/rfc/rfc8707) `resource`
parameter alongside the scope:

```
GET /auth
  ?client_id=apps.gallery
  &response_type=code
  &scope=openid%20gallery:images:read
  &resource=https://gallery.example.com/api
  &redirect_uri=...
```

The resource is any absolute URI without a fragment — conventionally the API's
own base URL. It does not have to be registered anywhere.

The resulting access token is a **self-contained JWT** audience-bound to that
resource, rather than the opaque reference token Passmower issues by default:

```json
{
  "iss": "https://passmower.example.com/",
  "aud": "https://gallery.example.com/api",
  "sub": "u-example",
  "client_id": "apps.gallery",
  "scope": "openid gallery:images:read"
}
```

So the API validates the token against Passmower's JWKS endpoint, checks `aud`
is itself, and authorizes from `scope` — with no introspection call and no
shared secret. Group membership rides along in the same token when the client
also requests the `groups` scope, and any
[claim mappings](claim-mappings.md) the client has are included unconditionally.

A client that requests no `resource` keeps getting an opaque access token, and
any API scopes it asked for are quietly not granted — there is no token for them
to be in.

## Semantics

- **`availableScopes` is the allowlist.** It becomes the resource server's scope
  set, so a client can only ever receive API scopes it lists. Requesting one it
  does not list is not an error; the scope is dropped.
- **The allowlist is per client, not per resource.** Every resource a given
  client names is offered the same scope set. Two applications with different
  API vocabularies are two `OIDCClient`s.
- **One access token, one resource.** An authorization may cover several
  resources, but each token request resolves to a single one and the token is
  bound to it. A client calling two APIs exchanges its refresh token once per
  API.
- **API scopes go through consent** like any other scope, listed under the
  resource they belong to, and are recorded on the grant.
- **Refresh tokens keep them.** A refresh exchange re-derives the resource
  server and re-filters the scopes against the current `availableScopes`, so
  narrowing the list takes effect on the next refresh.
- **They never become claims.** An API scope authorizes a call; it does not add
  anything to the ID token or UserInfo. Use
  [claim mappings](claim-mappings.md) for that.

## The cost of not having an enum

Because API scopes are the application's vocabulary, the CRD cannot know them,
and so it cannot reject an unknown scope. A misspelt *Passmower* scope —
`porfile` instead of `profile` — is therefore accepted by the API server and
then does nothing at all, where it used to be refused at `kubectl apply` time.
The schema still rejects anything that is not a legal scope token (spaces,
quotes, backslashes), since those cannot survive a space-delimited `scope`
parameter.

If a scope appears to be ignored, check it against the list at the top of this
page before looking further.

## The generated Secret

API scopes are rendered into `OIDC_AVAILABLE_SCOPES` in the client's generated
Secret along with everything else in `availableScopes`, joined by
`spec.availableScopesDelimiter` — which defaults to `,`, not the space the
OAuth2 wire format uses. Applications that read the value straight into a scope
parameter should set:

```yaml
spec:
  availableScopesDelimiter: " "
```

A scope token containing the delimiter would be ambiguous in that one value;
the `:`-separated convention above avoids the question.
