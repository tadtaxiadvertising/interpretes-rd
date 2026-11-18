#!/usr/bin/env bash
# Verifies actual HTTP readiness using the production Express Docker image.
# GitHub Actions provides an ephemeral PostgreSQL 16 service on localhost.
# Never substitute remote connection strings or Easypanel credentials here.
set -euo pipefail

image="interpretes-api:readiness-smoke"
healthy_name="api-readiness-ok-$GITHUB_RUN_ID-$GITHUB_RUN_ATTEMPT"
failed_name="api-readiness-db-down-$GITHUB_RUN_ID-$GITHUB_RUN_ATTEMPT"
ready_port=3109
failed_port=3110

cleanup() {
  docker rm -f "$healthy_name" "$failed_name" >/dev/null 2>&1 || true
}
trap cleanup EXIT

status_code() {
  curl --silent --max-time 3 --output /dev/null --write-out '%{http_code}' "$1" || true
}
require_status() {
  local url="$1"
  local expected="$2"
  local code="000"
  for ((i=0; i<20; i++)); do
    code="$(status_code "$url")"
    if [[ "$code" == "$expected" ]]; then return 0; fi
    sleep 2
  done
  echo "Expected HTTP $expected but received $code for readiness smoke route" >&2
  return 1
}

# The URLs below are hardcoded to ephemeral loopback databases only.
docker build --file Dockerfile.api --tag "$image" .
docker run --detach --rm --network host --name "$healthy_name" \
  --env PORT="$ready_port" \
  --env JWT_SECRET="synthetic-ci-api-readiness-secret-2026" \
  --env DATABASE_URL="postgresql://postgres:postgres@127.0.0.1:5432/interpreters_e2e" \
  "$image" >/dev/null
docker run --detach --rm --network host --name "$failed_name" \
  --env PORT="$failed_port" \
  --env JWT_SECRET="synthetic-ci-api-readiness-secret-2026" \
  --env DATABASE_URL="postgresql://postgres:postgres@127.0.0.1:5544/interpreters_e2e" \
  "$image" >/dev/null

# Both processes are live; only the one with a working database is ready.
require_status "http://127.0.0.1:$ready_port/health" 200
require_status "http://127.0.0.1:$ready_port/ready" 200
require_status "http://127.0.0.1:$failed_port/health" 200
require_status "http://127.0.0.1:$failed_port/ready" 503

headers="$(curl --silent --max-time 3 --dump-header - --output /dev/null "http://127.0.0.1:$failed_port/ready")"
if ! grep -qi '^Cache-Control: no-store' <<<"$headers"; then
  echo 'Readiness responses must not be cached by proxies' >&2
  exit 1
fi

# No 404 response may reflect query parameters that might contain credentials.
body="$(curl --silent --max-time 3 \
  "http://127.0.0.1:$ready_port/does-not-exist?token=SYNTHETIC_PRIVATE_TOKEN")"
if [[ "$body" == *SYNTHETIC_PRIVATE_TOKEN* ]]; then
  echo '404 response leaked a request query parameter' >&2
  exit 1
fi

echo 'Backend Docker smoke passed: live DB => ready, unavailable DB => 503.'
