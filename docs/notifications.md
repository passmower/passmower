# User notifications

Passmower can send short security notices to the affected user over every
channel they have:

- **Email** — the account's primary address, when email delivery is enabled
  (`passmower.outboundEmailEnabled`).
- **Slack DM** — when the Slack workspace integration is configured
  (`slackClientSecretRef`) and the account is linked to a Slack user.

Delivery is best-effort. A notification failure is logged and never affects
the flow that triggered it. Accounts with neither channel simply receive
nothing.

## Events

```yaml
passmower:
  notifications:
    onLogin: false
    onImpersonation: true
```

- `onLogin` (env `NOTIFY_ON_LOGIN`, default off): every fresh interactive
  sign-in, with the login method, source address, browser, and OS as reported
  by the proxy headers. Off by default because it is noisy for active users.
  Impersonated sign-ins do not trigger it; they are covered by the dedicated
  impersonation notification.
- `onImpersonation` (env `NOTIFY_ON_IMPERSONATION`, default on): the moment an
  administrator activates an impersonation link for the account, naming the
  administrator. Complements the incognito one-time impersonation links — the
  user is told who is acting as them and when.

The audit log independently records the same events regardless of these
settings; notifications are user-facing transparency, not the audit trail.
