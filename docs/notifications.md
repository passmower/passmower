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

## Slack message format

The magic-link sign-in DM is a [Block Kit](https://api.slack.com/block-kit)
message: what is being signed in to, a **Sign in** button carrying the one-time
link, and the requesting browser and IP underneath. It replaces the earlier
plain-text DM, where the raw URL was prone to being wrapped, truncated in a
preview, or turned into an unhelpful unfurl.

Every Slack message still carries plain `text` alongside its blocks — Slack uses
that for the notification and the channel preview, and falls back to it in
clients that cannot render blocks. The magic link is present in both, so the DM
is usable either way.

The button is a **link button**: it carries a URL and no `action_id`, so Slack
opens the browser and never calls back. That is deliberate — a button Slack has
to POST about would require a public interactivity request URL with
signing-secret verification, i.e. an inbound webhook surface on the identity
provider. Values interpolated into a message (client display names, ids) are
escaped for Slack mrkdwn, since they come from `OIDCClient` resources.

The security notices above are still sent as plain text; they have no action to
offer beyond what the text says.
