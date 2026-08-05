# Audit logging and application activity

Passmower emits a minimal structured audit record when a user successfully
authorizes a downstream application and when a client successfully exchanges a
grant. Audit logging is enabled by default. Records are written as JSON to
stdout with `logType: audit` and a versioned `audit` object.

```json
{
  "logType": "audit",
  "audit": {
    "schemaVersion": 1,
    "event": "application.login.succeeded",
    "timestamp": "2026-08-05T12:30:00.123Z",
    "subject": {"id": "u123"},
    "client": {"id": "apps.grafana", "namespace": "apps", "name": "grafana"},
    "result": "success"
  }
}
```

The built-in logger is a useful minimum and deliberately does not turn Redis or
the Kubernetes API into an audit database. Production installations should
route records marked `logType: audit` through the cluster log collector into a
durable, access-controlled backend such as Loki, OpenSearch, Splunk, or a SIEM.
Configure retention, immutability, backup, and access separately from ordinary
application logs.

Tokens, authorization codes, client secrets, cookies, claims, and raw session
identifiers are never included. Source addresses and user agents are personal
data and are disabled by default:

```yaml
passmower:
  audit:
    enabled: true
    includeSourceAddress: false
    includeUserAgent: false
```

## Kubernetes activity projections

Successful activity is aggregated and periodically projected into Kubernetes:

- `OIDCClient.status.lastUsedAt` and `OIDCMiddlewareClient.status.lastUsedAt`
  record the application's latest successful use.
- Their `status.conditions[type=Inactive]` indicates whether the client has
  exceeded `inactiveAfterDays`.
- `OIDCUser.status.recentApplications` contains the most recent successful use
  per application, sorted newest first and bounded by `recentApplicationLimit`.
- `passmower_oidc_client_last_used_timestamp_seconds` exposes the same client
  summary to Prometheus.

Each Passmower replica publishes its own view of the last-used gauge. Dashboards
and alerts should use `max by (kind, namespace, client)` across replicas.

These fields are summaries for administration and user interfaces, not an audit
history. By default Passmower flushes at most every 15 minutes rather than
writing to the Kubernetes API for every login:

```yaml
passmower:
  activityTracking:
    enabled: true
    flushIntervalSeconds: 900
    recentApplicationLimit: 20
    inactiveAfterDays: 90
```

Activity buffered since the previous flush may be lost if every Passmower pod
terminates simultaneously. Audit records are emitted immediately and remain the
historical source of truth once collected by a durable backend.

The admin UI shows a refined, read-only view of each user's bounded recent
application activity: application namespace/name, client kind, and last
authentication time. It does not return raw CRD status, conditions beyond those
already used by user administration, request metadata, or audit records.

## Reversibly disabling a client

Set `OIDCClient.spec.disabled: true` or `OIDCMiddlewareClient.spec.disabled: true`
to remove a client from the active provider
configuration. Passmower retains the resource and generated Secret, so setting
it back to `false` restores the same client ID and credentials. Passmower does
not automatically disable or delete inactive clients; use the condition or
metric to drive an administrator-reviewed policy.
