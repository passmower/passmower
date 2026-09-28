# Local development on Linux

Install minikube, a supported container driver (Docker or Podman), kubectl,
Helm, OpenSSL, and curl. Then run from the repository root:

```sh
bash scripts/dev-minikube.sh
```

The script creates a dedicated `passmower-dev` minikube profile and namespace,
without changing your current Kubernetes context. It builds the dev image inside
minikube's container runtime, installs Passmower and Redis, and runs Dex as a
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
`charts/passmower/values.dev.yaml`, which `skaffold dev` reads, is a Git-ignored
personal override and does not exist in a fresh checkout. The script uses its
own `passmower-dev` profile, so it never modifies or deletes another minikube
profile, including one that has lost its backing container.
