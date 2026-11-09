# User offboarding

Offboarding has two stages: **disable** the account, then, when nothing depends
on it any more, **remove** it.

## Disable

A disabled account is kept as it is: the `OIDCUser`, its profile, groups,
identities and passkeys all stay. Nothing can be done as it:

- every login method is refused;
- its live Passmower sessions end on their next request;
- refresh tokens are rejected with `invalid_grant`;
- forward-auth stops returning identity headers;
- Passmower's bearer APIs reject it;
- administrators cannot impersonate it;
- it drops out of the [privilege directory](privilege-directory.md), and its
  [profile page](user-profiles.md) says it is disabled.

Disabling is reversible. Two switches, either of which disables the account:

```yaml
apiVersion: codemowers.cloud/v1
kind: OIDCUser
metadata:
  name: johnsmith
spec:
  disabled: true
```

- `spec.disabled` is the declarative switch, for GitOps and `kubectl`:
  `kubectl patch oidcuser johnsmith --type merge -p '{"spec":{"disabled":true}}'`.
- The admin panel's **Disable** button sets `passmower.disabled`, in the section
  of the resource Passmower itself writes. **Enable** clears it. An account
  disabled through `spec.disabled` can only be enabled there, and an
  administrator cannot disable their own account from the panel.

As with [account types](account-types.md), self-contained JWT access tokens
already issued cannot be recalled and stay valid until they expire; use short
access-token lifetimes where that matters.

### Disabling the user's resources in applications

Passmower does not know what a user owns in each application (app passwords,
SSH keys, robot accounts, scheduled pipelines). Hand that to an
[`OIDCUserEventHook`](oidc-user-event-hooks.md): disabling or enabling a user
changes the resource generation, so hooks subscribed to `Modified` run, and
every hook Job receives `PASSMOWER_RESOURCE_DISABLED` (`true` or `false`)
alongside the user's name and UID.

```yaml
apiVersion: codemowers.cloud/v1
kind: OIDCUserEventHook
metadata:
  name: offboarding
spec:
  events: [Modified, Deleted]
  jobSpec:
    template:
      spec:
        serviceAccountName: offboarding
        containers:
          - name: offboard
            image: registry.example.com/offboarding:1.0.0
            # if [ "$PASSMOWER_EVENT_TYPE" = Deleted ]; then remove or transfer
            # elif [ "$PASSMOWER_RESOURCE_DISABLED" = true ]; then suspend
            # else restore; fi
        restartPolicy: OnFailure
```

A `Modified` event is not specific to disabling: it fires for any change to the
user. Write the Job to converge on the state it is told about, not to react to a
transition.

## Remove

Delete the `OIDCUser`. Hooks subscribed to `Deleted` run, which is where
per-application clean-up or transfer of the user's assets belongs. The caveats
in [the hook documentation](oidc-user-event-hooks.md) apply: delivery is at
least once, and a deletion that happens while Passmower is not watching can be
missed, so do not make a hook the only record of a mandatory deprovisioning.

Passmower removes what it created for the user itself (sessions, grants). What
an application created for them is that application's, or its hook's, to
remove.
