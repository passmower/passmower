# Local development on Linux

Install minikube, a supported container driver (Docker or Podman), kubectl,
Helm, OpenSSL, and curl. Then run from the repository root:

```sh
bash scripts/dev-minikube.sh
```

The script creates a dedicated `passmower-dev` minikube profile and namespace,
without changing your current Kubernetes context. It builds the production image
inside minikube's container runtime, installs Passmower and Redis, and runs Dex as a
stub upstream. No GitHub, email, or external cluster credentials are needed.
The URL is `https://passmower.<minikube-ip>.sslip.io/`; sslip.io supplies DNS for
the local IP. This requires a directly reachable minikube IP, as on Linux.

Import `.local-dev/ca.crt` as a trusted certificate authority in your browser
before opening the URL. Private keys stay in the ignored `.local-dev/` directory.
The script verifies HTTPS using that CA, without disabling certificate checking.
For command-line clients, use:

```sh
export SSL_CERT_FILE="$PWD/.local-dev/ca.crt"
export NODE_EXTRA_CA_CERTS="$PWD/.local-dev/ca.crt"
```

Choose **Sign in with Dex**. Dex's mock connector returns the fixed identity
`kilgore@kilgore.trout`, exercising real OIDC discovery, PKCE, signatures, and
Passmower enrollment. This is a private development stack: Dex allows anyone
who can reach it to assume that identity. Do not expose it through a public
tunnel or deploy the `dev/` chart into a shared/production cluster.

Run the script again to rebuild and redeploy changes. To retry an interrupted
installation using the already built image:

```sh
SKIP_BUILD=true bash scripts/dev-minikube.sh
```

Inspect or stop the stack with explicit context/profile selection:

```sh
kubectl --context=passmower-dev -n passmower-dev get pods
kubectl --context=passmower-dev -n passmower-dev logs deployment/passmower-dev
minikube stop -p passmower-dev
```

The script deploys with the checked-in `charts/passmower/values.local.yaml`.
It uses the production image with the chart's default non-root UID/GID 1000 and
read-only root filesystem. The script uses its own `passmower-dev` profile and
does not change other profiles.

## Skaffold on an existing cluster

Copy `skaffold.env.example` to `skaffold.env`, set the context, namespace and push
registry, and log Docker into that registry. Point `PASSMOWER_VALUES_FILE` at an
ignored local Helm values file. For an existing release, start with its values:

```sh
mkdir -p .local-dev
helm --kube-context YOUR_CONTEXT -n YOUR_NAMESPACE get values passmower -o yaml \
  > .local-dev/values.yaml
# Set PASSMOWER_VALUES_FILE=.local-dev/values.yaml in skaffold.env.
skaffold dev
```

Skaffold loads `skaffold.env`, builds the production image locally with host
networking, pushes it to `SKAFFOLD_DEFAULT_REPO`, and upgrades the existing
`passmower` Helm release in `SKAFFOLD_NAMESPACE`. Source changes rebuild the
image. Both the server and install-only signing-key initializer use that image.

Keep the existing hostname, TLS secret, Redis settings and credential Secret
references. Credentials remain in Kubernetes Secrets. The key initializer does
not run again on upgrades. Leave `SKAFFOLD_CLEANUP=false` to preserve the release
when exiting dev. A GitOps controller can overwrite development changes while
it is reconciling the same release.

Personal `skaffold.env*` and `.local-dev/` files are ignored. Only the generic
`skaffold.env.example` is committed. Use the minikube script above for a fresh,
isolated installation with Dex.
