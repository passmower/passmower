#!/usr/bin/env bash
# Linux minikube development stack. Keeps the current Kubernetes context intact.
set -euo pipefail
cd "$(dirname "$0")/.."

profile=passmower-dev
namespace=passmower-dev
state_dir="$PWD/.local-dev"
for tool in minikube kubectl helm openssl curl; do
    command -v "$tool" >/dev/null || { echo "Missing required tool: $tool" >&2; exit 1; }
done
if ! minikube -p "$profile" status >/dev/null 2>&1; then
    minikube start -p "$profile" --container-runtime=containerd --keep-context
fi
minikube -p "$profile" addons enable ingress
# NGINX otherwise sizes workers from host CPUs, exhausting Podman's PID limit
# on larger workstations even though this development node only needs two.
kubectl --context="$profile" -n ingress-nginx patch configmap ingress-nginx-controller \
    --type=merge -p '{"data":{"worker-processes":"2"}}'
kubectl --context="$profile" -n ingress-nginx rollout status deployment/ingress-nginx-controller --timeout=180s
cluster_ip=$(minikube -p "$profile" ip)
host="passmower.${cluster_ip}.sslip.io"
dex_issuer="http://${cluster_ip}:30556/dex"
kube=(kubectl --context="$profile" -n "$namespace")
kubectl --context="$profile" create namespace "$namespace" --dry-run=client -o yaml | kubectl --context="$profile" apply -f -

mkdir -p "$state_dir"
chmod 700 "$state_dir"
umask 077
if [[ ! -f "$state_dir/ca.key" ]]; then
    openssl req -config /dev/null -x509 -newkey rsa:3072 -nodes -days 365 -sha256 \
        -keyout "$state_dir/ca.key" -out "$state_dir/ca.crt" \
        -subj '/CN=Passmower local development CA' \
        -addext 'basicConstraints=critical,CA:TRUE' \
        -addext 'keyUsage=critical,keyCertSign,cRLSign'
fi
openssl req -config /dev/null -new -newkey rsa:2048 -nodes -keyout "$state_dir/tls.key" \
    -out "$state_dir/tls.csr" -subj "/CN=$host" \
    -addext "subjectAltName=DNS:$host" -addext 'extendedKeyUsage=serverAuth'
OPENSSL_CONF=/dev/null openssl x509 -req -in "$state_dir/tls.csr" -CA "$state_dir/ca.crt" \
    -CAkey "$state_dir/ca.key" -CAcreateserial -out "$state_dir/tls.crt" \
    -days 30 -sha256 -copy_extensions copy
"${kube[@]}" create secret tls passmower-dev-tls --cert="$state_dir/tls.crt" \
    --key="$state_dir/tls.key" --dry-run=client -o yaml | "${kube[@]}" apply -f -

helm upgrade --install passmower-dev-support ./dev --kube-context "$profile" \
    --namespace "$namespace" --set-string "passmowerHost=$host" \
    --set-string "dexIssuer=$dex_issuer" --wait --timeout 5m

# Build inside minikube: works with containerd, without a host Docker daemon.
# Set SKIP_BUILD=true to reuse the last local image after an interrupted install.
if [[ ${SKIP_BUILD:-false} != true ]]; then
    minikube -p "$profile" image build -t passmower:local-dev --build-opt opt=target=dev .
fi
helm upgrade --install passmower-dev ./charts/passmower --kube-context "$profile" \
    --namespace "$namespace" -f charts/passmower/values.local.yaml \
    --set-string image.repository=passmower --set-string image.tag=local-dev \
    --set-string "passmower.host=$host" \
    --set-string "passmower.oidcProviders.dex.issuer=$dex_issuer" \
    --set-string 'ingress.tls[0].secretName=passmower-dev-tls' \
    --set-string "ingress.tls[0].hosts[0]=$host" --wait --timeout 5m
"${kube[@]}" rollout restart deployment/passmower-dev
"${kube[@]}" rollout status deployment/passmower-dev --timeout=180s
curl --fail --silent --show-error --connect-timeout 5 --max-time 15 \
    --retry 10 --retry-all-errors --retry-delay 2 \
    --cacert "$state_dir/ca.crt" "https://$host/.well-known/openid-configuration" >/dev/null
echo "Passmower: https://$host/"
echo "Trust $state_dir/ca.crt in your browser before signing in."
echo "For CLI clients: export SSL_CERT_FILE=$state_dir/ca.crt NODE_EXTRA_CA_CERTS=$state_dir/ca.crt"
echo "Dex supplies a fixed development identity; keep this cluster private."
