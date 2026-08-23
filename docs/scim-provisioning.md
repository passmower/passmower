# SCIM 2.0 provisioning

Passmower exposes one RFC 7644 endpoint per `SCIMConnection` resource:

```text
https://passmower.example.com/scim/v2/<connection-id>
```

The connection, not an environment variable, is the authorization boundary.
It binds independently rotatable credential hashes to exactly one destination
Passmower group. You can run a single connection for one upstream directory,
or many connections side by side — each is fully isolated from the others.

## Creating a connection

A `SCIMConnection` is a namespaced custom resource in Passmower's namespace.
Create it the same way you manage any other Passmower resource — `kubectl
apply`, GitOps, or your own tooling. SCIM clients themselves must never be
allowed to create or update these resources; only the bearer-token-scoped
`/scim/v2/<connection-id>` endpoint is exposed to them.

Generate a random token and store only its SHA-256 hash:

```sh
TOKEN=$(openssl rand -hex 32)
echo "Tenant URL:   https://passmower.example.com/scim/v2/acme"
echo "Bearer token: ${TOKEN}"
echo -n "${TOKEN}" | sha256sum
```

```yaml
apiVersion: codemowers.cloud/v1
kind: SCIMConnection
metadata:
  name: acme
spec:
  group:
    prefix: codemowers
    name: org-acme
  grantMode: all-users
  tokenHashes:
    # Lowercase SHA-256 of the random token. The raw token is configured in
    # the provisioning client (e.g. the Entra enterprise application) and is
    # never persisted by Passmower.
    - 0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef
  linking:
    provider: entra
    tenantClaim: tid
    tenantValue: 11111111-2222-3333-4444-555555555555
    subjectClaim: oid
  disabled: false
```

`tokenHashes` accepts at most two hashes so rotation can overlap safely:
prepend the new hash, reconfigure the provisioning client, then remove the old
hash. `group` and `grantMode` are operator policy; SCIM payloads cannot
override them.

To revoke a connection, set `disabled: true` (or delete the resource). Its
bearer credentials fail immediately and the connection operator tombstones the
group projections it made. Re-enabling requires editing the resource again.

Grant modes:

- `all-users`: every active user provisioned through this connection receives
  its destination group. This matches Entra deployments that assign users
  directly to the enterprise application.
- `mapped-groups`: an active user receives the destination group only while
  it belongs to at least one group provisioned through this connection.

## Isolation invariants

For every request Passmower:

1. resolves the connection ID from the URL,
2. hashes the bearer token and compares it with that connection's hashes,
3. constructs a repository scoped to that connection's source key,
4. returns and mutates only subjects and groups owned by that source key, and
5. derives projected groups only from `SCIMConnection.spec.group`.

A valid token for connection A receives `401` from connection B. External IDs,
usernames, filters, group IDs, and membership IDs are unique only within their
connection. Resource IDs include the connection UID in their hash input, so the
same upstream external ID in two connections cannot collide.

Disabling or deleting a connection immediately makes its bearer credentials
fail and the connection operator tombstones only projections owned by its
source UID. It never edits native, GitHub, generic OIDC, or another SCIM
connection's memberships. Subjects and external groups remain as audit/recovery
records until a separate retention policy removes them.

## Identity linking

SCIM provisioning describes a directory subject; it does not prove which
interactive Passmower account that subject controls. Accounts must not be
merged by email alone.

The data model separates:

```text
SCIMConnection
  └── SCIMSubject(connection UID, external ID, attributes, active)
        └── MembershipGrant(connection UID, external group ID, destination group)
              └── optional verified link to OIDCUser
```

The SCIM route stores provisioned people as `SCIMSubject` and external groups
as `SCIMGroup`. It never creates an `OIDCUser`; an unlinked subject therefore
cannot log in and its desired destination groups cannot appear in tokens.
Source-group membership and the derived destination-group intent currently live
on `SCIMSubject.spec.identity`. A future dedicated grant resource may be added
if independent grant audit/history or very large membership sets require it.

A link becomes valid only when an interactive upstream identity supplies a
stable identifier configured for that connection—for Entra, normally tenant ID
plus object ID. Passmower's generic OIDC identity record must retain those
verified claims. Configure the matching provider to retain only those claims:

```yaml
passmower:
  oidcProviders:
    - key: entra
      issuer: https://login.microsoftonline.com/organizations/v2.0
      clientSecretRef: entra-credentials
      linkingClaims: [tid, oid]
```

Email may be shown as a linking hint, but may not authorize the link. Until
linking succeeds, the SCIM subject and its grants remain pending and do not
issue token groups. Linking failures fail closed for the grant but do not block
a successfully verified upstream login.

## Connection status

The connection operator writes a `Ready` condition and connection-scoped
`userCount` and `groupCount` values to `SCIMConnection.status`. A disabled
connection reports `Ready=False` with reason `Disabled`; an enabled connection
reports `Ready=True` with reason `Available`. Counts select records by the
connection UID, so deleting and recreating a connection name cannot mix
provisioned state. These fields are operational summaries and do not expose
identities or credentials.

## SCIM protocol scope

The implementation covers Users and Groups CRUD, `eq`/`and` filters,
pagination, PATCH, bearer authentication, discovery endpoints, and
deprovisioning. It does not implement Bulk, sorting, password changes,
conditional requests (ETags are emitted for information only), or enterprise
schema extensions. `ServiceProviderConfig` advertises these limits.

Previously issued access tokens retain old groups until expiry. Online gates
or shorter access-token lifetimes are required where immediate revocation is a
hard requirement.
