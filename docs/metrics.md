# Prometheus metrics

Passmower serves Prometheus metrics on port `9090` at `/metrics` (the same
listener also serves `/health`). Default Node.js process metrics are included;
every series carries `instance` (the issuer URL) and `deployment` labels.

## Usage metrics

| Metric | Type | Labels | Meaning |
|---|---|---|---|
| `passmower_authorization_success_count` | counter | `client_id`, `kind` | Successful application authorizations since process start. |
| `passmower_active_sessions` | gauge | — | Stored OIDC provider sessions, computed from Redis at scrape time. |
| `passmower_active_users` | gauge | — | Unique accounts with at least one active session. Anonymous/pre-login sessions count toward sessions but not users. |
| `passmower_group_members` | gauge | `group` | Accounts per group, updated on user reconciliation. **Disabled by default** — enable with `passmower.metrics.groupMembershipCounts` only when your monitoring stack may hold group-membership information. |

Request-rate style metrics deliberately stay with the ingress/proxy layer
(e.g. Traefik service metrics) instead of being duplicated here.

## Health and error metrics

| Metric | Type | Labels | Meaning |
|---|---|---|---|
| `passmower_oidc_client_last_used_timestamp_seconds` | gauge | `kind`, `namespace`, `client` | Latest successful OIDC activity per client, zero if never used. |
| `passmower_oidc_user_email_conflicts` | gauge | — | OIDCUser resources rejected because an older user owns a claimed email. |
| `passmower_non_existent_client_request_count` | counter | `in_cluster` | Authentication requests naming an unknown client ID. |
| `passmower_invalid_client_request_count` | counter | `client_id`, `reason`, `in_cluster` | Invalid authentication requests. |
| `passmower_invalid_userinfo_request_count` | counter | `reason`, `in_cluster` | Invalid userinfo endpoint requests. |
| `passmower_invalid_token_request_count` | counter | `reason`, `in_cluster` | Invalid token endpoint requests. |

```yaml
passmower:
  metrics:
    groupMembershipCounts: false
```
