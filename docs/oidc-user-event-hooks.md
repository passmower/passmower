# OIDCUser lifecycle Job hooks

`OIDCUserEventHook` runs a Kubernetes `Job` when a matching `OIDCUser` is added,
its spec generation changes, or it is deleted. Hooks and users must be in the
same namespace; the generated Job also runs in that namespace.

```yaml
apiVersion: codemowers.cloud/v1
kind: OIDCUserEventHook
metadata:
  name: directory-sync
  namespace: passmower
spec:
  selector:
    matchLabels:
      directory-sync: enabled
    matchExpressions:
      - key: account-type
        operator: In
        values: [person, service]
  events: [Added, Modified, Deleted]
  jobSpec:
    ttlSecondsAfterFinished: 900
    template:
      spec:
        serviceAccountName: directory-sync
        containers:
          - name: sync
            image: registry.example.com/directory-sync:1.0.0
        restartPolicy: OnFailure
```

`selector` uses the Kubernetes `LabelSelector` shape: `matchLabels` plus the
`In`, `NotIn`, `Exists`, and `DoesNotExist` match-expression operators. Omitting
it matches every `OIDCUser` in the hook namespace. A `Modified` event is emitted
only when `metadata.generation` changes, so status-only reconciliation does not
run hooks.

Passmower adds the following literal environment variables to every regular and
init container, replacing same-named entries from the template:

| Variable | Value |
|---|---|
| `PASSMOWER_EVENT_TYPE` | `Added`, `Modified`, or `Deleted` |
| `PASSMOWER_RESOURCE_KIND` | `OIDCUser` |
| `PASSMOWER_RESOURCE_NAMESPACE` | User namespace |
| `PASSMOWER_RESOURCE_NAME` | User resource name |
| `PASSMOWER_RESOURCE_UID` | User Kubernetes UID |
| `PASSMOWER_RESOURCE_GENERATION` | User spec generation |

The full `OIDCUser`, email addresses, identities, tokens, and credentials are
not injected. A hook that requires them must use an explicitly authorized
service account and query the Kubernetes API itself.

Generated Jobs have deterministic names based on the hook, user UID,
generation, and event type. This deduplicates concurrent Passmower replicas and
routine watch reconnects while the process and Job still exist. Passmower
defaults `restartPolicy` to `OnFailure` and `ttlSecondsAfterFinished` to `3600`;
either can be overridden in `jobSpec`. Jobs are owned by the hook and labelled
for monitoring.

Hook delivery is **at least once**, not exactly once. Kubernetes replays
existing resources as `Added` when a watch starts. Passmower suppresses those
replays across watch reconnects within one process. If a known user's generation
advanced during a watch gap, Passmower classifies the replay as `Modified` so
that edge is not silently lost. A Passmower pod restart loses this in-memory
history, however. If the deterministic Added Job has already been reaped, the
replacement pod can create it again. Hook workloads must therefore handle
repeated Added events idempotently.

The operator is edge-triggered and does not persist a user-event journal. A
Deleted event that occurs while Passmower is stopped or outside an active watch
can be missed permanently. Do not use this initial hook implementation as the
only record for mandatory deprovisioning; periodically reconcile the target
system or retain another authoritative lifecycle record.

The hook status records the last attempted Job and a `Ready` condition. Failed
Job creation sets `Ready=False` with reason `JobCreationFailed` and emits a
Kubernetes Warning event on the hook.

## Security

Permission to create or update `OIDCUserEventHook` is workload-creation
authority. Its `jobSpec` can execute arbitrary images and select any
ServiceAccount that the namespace's admission and RBAC policies permit. Restrict
hook writes to the same trusted administrators who may create Jobs, and enforce
image, ServiceAccount, and pod-security policy with admission controls where
required.
