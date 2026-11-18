#!/usr/bin/env bash
# Explicitly tests the public signup privilege boundary on a disposable DB.
# Never point this job at a remote PostgreSQL or production backend.
set -euo pipefail

name="api-public-signup-ci-$GITHUB_RUN_ID-$GITHUB_RUN_ATTEMPT"
port=3112
image="interpretes-api:public-signup-ci"
temp="$(mktemp -d)"

cleanup() {
  docker rm -f "$name" >/dev/null 2>&1 || true
  rm -rf "$temp"
}
trap cleanup EXIT

docker build --file Dockerfile.api --tag "$image" .
docker run --detach --rm --network host --name "$name" \
  --env PORT="$port" \
  --env JWT_SECRET="synthetic-ci-public-signup-secret-2026" \
  --env DATABASE_URL="postgresql://postgres:postgres@127.0.0.1:5432/interpreters_e2e" \
  "$image" > /dev/null

ready=0
for ((i=0; i<25; i++)); do
  status="$(curl --silent --max-time 3 --output /dev/null \
    --write-out '%{http_code}' "http://127.0.0.1:$port/ready" || true)"
  if [[ "$status" == "200" ]]; then ready=1; break; fi
  sleep 2
done
if [[ "$ready" != "1" ]]; then
  echo 'Backend was not ready with isolated PostgreSQL' >&2
  exit 1
fi

post_register() {
  local payload="$1"
  curl --silent --max-time 12 --output "$temp/response.json" \
    --write-out '%{http_code}' \
    --header 'Content-Type: application/json' \
    --data-binary "$payload" \
    "http://127.0.0.1:$port/api/auth/register"
}

# Neither of these privileged identities may be provisioned by an anonymous
# HTTP caller. Only the authenticated administrative routes may create them.
for role in ADMIN HOLDER; do
  status="$(post_register \
    "{\"email\":\"ci-denied-$role-$GITHUB_RUN_ID@example.test\",\"password\":\"SyntheticPassword2026!\",\"name\":\"Synthetic Applicant\",\"role\":\"$role\"}")"
  if [[ "$status" != "400" ]]; then
    echo 'Public registration accepted or mishandled a privileged role' >&2
    exit 1
  fi
done

# Legitimate self-signup must still work; assert the role written to the DB
# (returned by Prisma's select projection) cannot be supplied by the client.
status="$(post_register \
  "{\"email\":\"ci-ordinary-$GITHUB_RUN_ID@example.test\",\"password\":\"SyntheticPassword2026!\",\"name\":\"Synthetic Applicant\"}")"
if [[ "$status" != "201" ]]; then
  echo 'Ordinary self-registration failed unexpectedly' >&2
  exit 1
fi
node - "$temp/response.json" <<'NODE'
const fs = require('node:fs');
const response = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
if (!response.success || response.data?.role !== 'INTERPRETER' || response.data?.password) {
  console.error('The public register response must contain only an INTERPRETER account');
  process.exit(1);
}
NODE

echo 'Public signup isolation smoke passed using synthetic local users.'
