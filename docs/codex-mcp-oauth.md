# Codex MCP OAuth callbacks

Codex signs in to an MCP server with a loopback callback. For a pre-registered
client with no `callback_url`, Codex appends a server-specific ID to the callback
path, producing `http://127.0.0.1:<port>/callback/<id>`. Passmower matches the
registered path exactly, so it rejects that URL with `invalid_redirect_uri`.

Configure both the listener port and the complete callback URL in the
project's `.codex/config.toml`:

```toml
[mcp_servers.driftmower.oauth]
client_id = "kube-system.driftmower-mcp"
callback_port = 33418
callback_url = "http://127.0.0.1:33418/callback"
```

and register the same URL on the `OIDCClient`:

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

Codex uses an explicit `callback_url` as-is only when the authorization server
supports issuer identification. Passmower's discovery document advertises
`authorization_response_iss_parameter_supported: true`; a proxy in front of
discovery must pass that field through. See the
[Codex configuration reference](https://learn.chatgpt.com/docs/config-file/config-reference).
This configuration is tested with Codex 0.155.1.

Passmower does not accept wildcard or suffixed callback paths. For native
clients the loopback port may differ from the registered one, as
[RFC 8252 section 7.3](https://www.rfc-editor.org/rfc/rfc8252.html#section-7.3)
requires; the path must match.

For a local HTTPS instance, trust the development CA in the CLI and browser as
described in [Local development](local-development.md).
