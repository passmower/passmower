# Codex MCP OAuth callbacks

For a pre-registered Passmower native client, configure both the callback listener
port and the complete callback URL in the project's `.codex/config.toml`:

```toml
[mcp_servers.driftmower.oauth]
client_id = "kube-system.driftmower-mcp"
callback_port = 33418
callback_url = "http://127.0.0.1:33418/callback"
```

The corresponding `OIDCClient` must use:

```yaml
spec:
  applicationType: native
  tokenEndpointAuthMethod: none
  pkce: true
  grantTypes: [authorization_code, refresh_token]
  responseTypes: [code]
  redirectUris:
    - http://127.0.0.1:33418/callback
```

Codex 0.155.1 can append a server-specific ID when a pre-registered client has no
configured callback URL. In a local reproduction of issue #276, repeated logins
with the same project configuration used the same suffix. Setting `callback_url`
explicitly made Codex use the registered `/callback` path.
This was verified through a complete Codex 0.155.1 login and token exchange
against Passmower running in minikube, with Dex as the upstream provider.

Codex reuses this explicit URL when the authorization server advertises issuer
identification. Passmower's discovery document already advertises
`authorization_response_iss_parameter_supported: true`; preserve this metadata
if discovery passes through a proxy. See the
[Codex configuration reference](https://learn.chatgpt.com/docs/config-file/config-reference).

Passmower continues to require an exact registered callback path. Native loopback
ports may vary, but wildcard paths are not needed for this configuration and
would depart from [RFC 8252 section 8.4](https://www.rfc-editor.org/rfc/rfc8252.html#section-8.4).

For a local HTTPS instance, trust the development CA in the CLI and browser as
described in [Local development](local-development.md).
