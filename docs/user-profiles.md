# User profile pages

Passmower can give every user a profile page at `/users/<username>`, so that
an application showing an OIDC subject can make it a link to a person. The
username is the `sub` claim.

Profile pages are disabled by default:

```yaml
passmower:
  userProfiles:
    enabled: true
```

Without the Helm chart, set `USER_PROFILES_ENABLED=true`.

## What a page shows

Any signed-in user can open any user's page. It shows a refined projection:

- display name and username;
- company;
- primary email;
- a "Message on Slack" link, when the Slack integration is enabled and the
  account is linked;
- membership of the groups published in the
  [privilege directory](privilege-directory.md) (`privilegeDirectoryGroups`),
  each linking to that role's page. With no groups published, none are shown.

It does not expose the user CRD, other group memberships, other email
addresses, phone numbers, identities, conditions, sessions or activity.

Person and service accounts have a page; a service account is marked as one.
Reserved names (`banned`, `org` and `group` accounts) and unknown usernames
return `404`.

Treat enabling it as a privacy decision: every signed-in user can look up the
name, company and primary email of any other user whose username they know or
can guess.

## Linking a subject from an application

With profile pages enabled, the `profile` scope also carries the standard OIDC
[`profile` claim](https://openid.net/specs/openid-connect-core-1_0.html#StandardClaims),
the URL of the user's page:

```json
{
  "sub": "johnsmith",
  "name": "John Smith",
  "profile": "https://auth.example.com/users/johnsmith"
}
```

An application that only stores `sub` can build the same URL itself:
`<issuer>/users/<sub>`.

A signed-out visitor following such a link signs in first and is then taken to
the page they asked for. The same now holds for shared `/privileges/<group>`
and `/profile` links.

The API behind the page is `GET /api/users/<username>`, available to a signed-in
dashboard session only.
