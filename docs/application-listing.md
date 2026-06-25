# Listing a user's applications

Passmower can tell an application which other applications the signed-in user is
allowed to open. This is meant for dashboards, launchers and shared navbars that
want to render an "apps you can access" list without re-implementing Passmower's
group-based authorization. Both `OIDCClient`s and `OIDCMiddlewareClient`s that
declare a `uri` are included.

Two scopes expose this, with different audiences:

| Scope | Delivery | Contents |
| --- | --- | --- |
| `applications` | `applications` claim on the **userinfo** response | only the apps the current user can access |
| `all_applications` | `GET /api/apps/all` (REST) | every enrolled app, annotated with `accessible`; **admins only** |

## `applications` — the user's own launcher list

Add `applications` to the client's `availableScopes` and request it at login
(e.g. `scope=openid applications`). The list is returned **only on the userinfo
endpoint**, not in the ID token, to keep tokens small — so the client must
perform an authorization-code flow and call userinfo (an implicit ID-token-only
client cannot read it):

```jsonc
// GET /me  (userinfo)
{
  "sub": "johnsmith",
  "applications": [
    {
      "name": "Grafana",
      "url": "https://grafana.example.com",
      "groups": ["github.com:example-org:grafana-users-team"],
      "displayOrder": 0
    }
  ]
}
```

Each entry carries the app's `allowedGroups` as `groups`, so a consumer can group
or filter the list further (and cross-reference it against the user's own
`groups` claim).

## `all_applications` — the full catalog (admins)

For cluster-overview tooling that needs the complete inventory rather than the
caller's own apps, add `all_applications` to `availableScopes` and call:

```
GET /api/apps/all
Authorization: Bearer <access token carrying the all_applications scope>
```

The endpoint is gated twice: the access token must carry the `all_applications`
scope **and** the user must be an admin (member of `ADMIN_GROUP`); otherwise it
returns `403`. Every enrolled app is returned with an `accessible` boolean
indicating whether the calling user may open it:

```jsonc
{
  "apps": [
    { "name": "Grafana", "url": "https://grafana.example.com",
      "groups": ["github.com:example-org:grafana-users-team"],
      "displayOrder": 0, "accessible": true }
  ]
}
```

## Ordering with `displayOrder`

Both client kinds accept an optional integer `displayOrder` (default `0`) used to
order the lists above. Lower values sort first; ties break alphabetically by
name. Leave it unset for plain alphabetical ordering.

```yaml
apiVersion: codemowers.cloud/v1beta1
kind: OIDCClient
metadata:
  name: grafana
spec:
  displayName: Grafana
  uri: https://grafana.example.com
  displayOrder: -10        # pin Grafana near the top of the launcher
  availableScopes:
    - openid
    - profile
    - applications
    - all_applications     # only for clients that need the admin catalog
  # ... other fields ...
```
