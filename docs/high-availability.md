# Running more than one replica

Passmower is two things in one process: an authorization server serving HTTP,
and a set of controllers reconciling `OIDCClient`, `OIDCMiddlewareClient`,
`OIDCUser`, `OIDCUserEventHook`, `SCIMConnection` and (optionally) `Ingress`
resources.

The HTTP half is stateless — sessions and client registrations live in Redis,
signing keys in a Secret — so it scales horizontally. The controllers are
single-writer by nature. `replicaCount` above 1 therefore elects one replica to
reconcile while every replica keeps serving sign-ins.

```yaml
replicaCount: 3
passmower:
  leaderElection:
    enabled: true   # the default
```

## How the election works

One `coordination.k8s.io` Lease, named `passmower-operators` by default, in the
release namespace. The holder runs the operators; everyone else waits. The
holder renews every few seconds, and a replica that stops renewing — because it
was deleted, lost its node, or lost its API connection — has its Lease taken
over once it expires.

The identity in the Lease is the **pod name**, passed in as `POD_NAME` through
the downward API. This is deliberately not the identity used in
`status.instance` on client resources: that one is the namespace plus the
Deployment name, which answers "two Passmowers in one cluster, whose client is
this?" and is identical in every replica of one Deployment.

On a graceful shutdown the holder releases the Lease rather than leaving it to
expire, so a rolling restart hands reconciliation over in seconds.

Tuning, should the defaults not suit: `LEADER_LEASE_DURATION_SECONDS` (15),
`LEADER_RENEW_DEADLINE_SECONDS` (10), `LEADER_RETRY_PERIOD_SECONDS` (2),
`LEADER_ELECTION_LEASE_NAME`.

## What is not leader-only

**Activity tracking.** Each pod records the sign-ins it served, and no other pod
knows about them, so every replica flushes its own activity onto `OIDCUser` and
client resources. Those writes are read-modify-write with a retry on conflict,
which is what makes concurrent flushes safe.

One consequence worth knowing: the `passmower_oidc_client_last_used` gauge for
clients that saw *no* traffic is maintained by the leader, because only the
leader watches the full set of clients. The series moves between pods when
leadership does.

**Serving HTTP.** Nothing on the request path needs the operators. Clients are
read from the shared Redis, and the login path writes users directly.

## Turning it off

`passmower.leaderElection.enabled: false` runs the operators in every replica,
which is what releases before 2.3 did. The writers converge rather than corrupt
— whoever creates a client Secret first wins and the others adopt it — so this
is safe, but it multiplies API churn by the replica count.

If the Lease RBAC is missing (an image upgraded without the chart), Passmower
logs an error and runs the operators anyway rather than leaving the cluster
unreconciled. Grant `coordination.k8s.io` `leases` — the chart does — or set
`LEADER_ELECTION_ENABLED=false` to silence it.

## Leases are not a correctness boundary

A Lease hands over on expiry as well as on a clean stop, so two holders can
briefly overlap and whatever the outgoing one had in flight still lands. The
controllers are written to converge under that, and must stay that way: election
reduces duplicated work, it does not make unsafe writers safe.
