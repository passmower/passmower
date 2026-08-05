# Privilege directory

Passmower can publish an authenticated, read-only directory showing who belongs
to selected groups. It gives users a stable page to reference when they need to
request access or contact someone responsible for a role.

The directory is disabled by default. Explicitly list the groups that may be
shown in Helm values:

```yaml
passmower:
  privilegeDirectoryGroups:
    - example.com:kubernetes-admins
    - github.com:example-org:billing
```

Without the Helm chart, set `PRIVILEGE_DIRECTORY_GROUPS` to the equivalent JSON
array string, for example:

```shell
PRIVILEGE_DIRECTORY_GROUPS='["example.com:kubernetes-admins","github.com:example-org:billing"]'
```

Authenticated users can then open `/privileges` for the complete configured
directory. Each role heading links to `/privileges/<group>`, a shareable view
containing only that role.

Only person accounts are included. The API exposes a refined projection for
each member: username, display name, and primary email. It does not expose the
user CRD, other group memberships, conditions, identities, or audit activity.
Groups not present in `privilegeDirectoryGroups` return `404`, even if they
exist on an account.

Treat the configured list as a privacy decision. The page requires a valid
Passmower site session, but every authenticated user can view its contents.
