# Email delivery and email-free operation

`EMAIL_ENABLED=false` (Helm: `passmower.emailEnabled: false`) disables every
outbound email path. Passmower does not initialize Nodemailer, does not mount
`emailCredentialsSecretRef`, hides magic-link login and email-based admin
invitations, and records Terms of Service acceptance without attempting to send
a receipt.

Email-free installations can enroll users from GitHub or generic OIDC by the
provider's stable identity (GitHub numeric ID or OIDC provider key plus `sub`).
Generic providers default to the `openid profile` scopes in this mode, and
GitHub does not request `user:email` or call the email API. Provider definitions
may still explicitly request `email`; an address returned in that case is
retained for identity linking and downstream claims, but it is not required.

Accounts without a primary address omit `email` and `email_verified` from ID
tokens and UserInfo, even when a downstream client requests the `email` scope.
Forward-auth also omits the configured email header for those accounts.

```yaml
passmower:
  emailEnabled: false
  # emailCredentialsSecretRef may be empty or omitted
  oidcProviders:
    dex:
      issuer: https://dex.example.com
      clientSecretRef: dex-client
      scopes: [openid, profile]
```

When email is enabled, Passmower fails at startup unless `EMAIL_HOST`,
`EMAIL_PORT`, `EMAIL_SSL`, `EMAIL_USERNAME`, and `EMAIL_PASSWORD` are present.
The Helm chart likewise requires `passmower.emailCredentialsSecretRef`. A
temporary ToS receipt failure is logged but does not undo acceptance or block
login; magic-link delivery failures remain fatal to that login attempt.
