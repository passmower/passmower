#!/usr/bin/env bash
# Bring up the full e2e stack locally and run the Playwright login test:
#   Redis + Dex (docker compose) + a kind Kubernetes cluster (CRDs applied) +
#   passmower (host node process, built frontend) + Playwright.
#
# Requires: docker/podman, kind, kubectl, node. CI does the equivalent inline.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"

CLUSTER=passmower-e2e
APP_PID=""
cleanup() {
    [ -n "$APP_PID" ] && kill "$APP_PID" 2>/dev/null || true
    docker compose -f docker-compose.test.yml down -v || true
    kind delete cluster --name "$CLUSTER" || true
}
trap cleanup EXIT

echo "==> Redis + Dex"
docker compose -f docker-compose.test.yml up -d

echo "==> Kubernetes (kind) + CRDs"
kind create cluster --name "$CLUSTER"
kubectl apply -f charts/passmower/templates/crds.yaml
kubectl create namespace passmower-test --dry-run=client -o yaml | kubectl apply -f -
export KUBECONFIG="${KUBECONFIG:-$HOME/.kube/config}"

echo "==> Build frontend + styles"
npm --prefix frontend ci && npm --prefix frontend run build
npm --prefix styles ci && npm --prefix styles run sass-prod

echo "==> Wait for Dex discovery"
for i in $(seq 1 30); do
    curl -sf http://127.0.0.1:5556/dex/.well-known/openid-configuration >/dev/null && break
    sleep 1
done

echo "==> Start passmower"
set -a; . test/e2e/passmower.env; set +a
export OIDC_COOKIE_KEYS='["e2e-cookie-secret-0123456789abcdef0123456789"]'
export OIDC_JWKS="$(node -e "const {generateKeyPairSync}=require('crypto');const {privateKey}=generateKeyPairSync('rsa',{modulusLength:2048});const j=privateKey.export({format:'jwk'});j.use='sig';j.alg='RS256';j.kid='e2e';console.log(JSON.stringify([j]))")"
node src/app.js & APP_PID=$!

echo "==> Wait for passmower"
for i in $(seq 1 30); do
    curl -sf http://127.0.0.1:3000/.well-known/openid-configuration >/dev/null && break
    sleep 1
done

echo "==> Playwright"
npx playwright test
