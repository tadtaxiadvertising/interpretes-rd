#!/usr/bin/env bash
# Build a single Intérpretes RD Docker image on a GitHub-hosted runner.
# Does not deploy, call Easypanel, run migrations, or push to a registry.
set -euo pipefail

component="${1:-}"
if [[ "${GITHUB_ACTIONS:-}" != "true" || "${RUNNER_ENVIRONMENT:-}" != "github-hosted" ]]; then
  echo "::error::Off-host image build only runs on GitHub-hosted runners; refusing self-hosted/VPS execution."
  exit 78
fi
if [[ "${GITHUB_REF:-}" != "refs/heads/main" || ! "${GITHUB_SHA:-}" =~ ^[0-9a-fA-F]{40}$ ]]; then
  echo "::error::Image builds require a reviewed main SHA."
  exit 78
fi
if [[ ! "${GITHUB_REPOSITORY:-}" =~ ^[a-zA-Z0-9_.-]+/[a-zA-Z0-9_.-]+$ ]]; then
  echo "::error::Missing valid repository context."
  exit 78
fi

case "$component" in
  frontend)
    dockerfile="Dockerfile"
    # These are *public* browser build parameters, not API secrets.
    for key in NEXT_PUBLIC_SUPABASE_URL NEXT_PUBLIC_SUPABASE_ANON_KEY NEXT_PUBLIC_API_URL; do
      if [[ -z "${!key:-}" ]]; then
        echo "::error::Missing required public frontend build configuration: $key"
        exit 78
      fi
    done
    ;;
  api) dockerfile="Dockerfile.api" ;;
  worker) dockerfile="Dockerfile.worker" ;;
  *) echo "::error::Unsupported image component."; exit 78 ;;
esac

# No Docker build on the basis of pending or failed checks. This also
# verifies the selected main SHA has not been superseded.
node scripts/ci/verify-offhost-release-gate.mjs

repo="${GITHUB_REPOSITORY,,}"
image="ghcr.io/${repo}-${component}:sha-${GITHUB_SHA,,}"
if [[ -n "${GITHUB_ENV:-}" ]]; then
  printf 'OFFHOST_IMAGE=%s\n' "$image" >> "$GITHUB_ENV"
fi

case "$component" in
  frontend)
    docker build --file "$dockerfile" --tag "$image" \
      --label "org.opencontainers.image.source=https://github.com/${GITHUB_REPOSITORY}" \
      --label "org.opencontainers.image.revision=${GITHUB_SHA}" \
      --build-arg "GIT_SHA=${GITHUB_SHA}" \
      --build-arg "NEXT_PUBLIC_SUPABASE_URL=${NEXT_PUBLIC_SUPABASE_URL}" \
      --build-arg "NEXT_PUBLIC_SUPABASE_ANON_KEY=${NEXT_PUBLIC_SUPABASE_ANON_KEY}" \
      --build-arg "NEXT_PUBLIC_API_URL=${NEXT_PUBLIC_API_URL}" \
      --build-arg "NEXT_PUBLIC_APP_ROLE=${NEXT_PUBLIC_APP_ROLE:-}" \
      .
    ;;
  api)
    docker build --file "$dockerfile" --tag "$image" \
      --label "org.opencontainers.image.source=https://github.com/${GITHUB_REPOSITORY}" \
      --label "org.opencontainers.image.revision=${GITHUB_SHA}" \
      --build-arg "GIT_SHA=${GITHUB_SHA}" .
    ;;
  worker)
    docker build --file "$dockerfile" --tag "$image" \
      --label "org.opencontainers.image.source=https://github.com/${GITHUB_REPOSITORY}" \
      --label "org.opencontainers.image.revision=${GITHUB_SHA}" .
    ;;
esac

echo "Build completed on GitHub-hosted runner; no remote deployment was requested."
