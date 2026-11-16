#!/usr/bin/env bash
# GitHub Actions deployment gate. Never apply migrations or call Easypanel
# for a commit that is no longer the HEAD of main.
set -euo pipefail

if [[ "${GITHUB_REF:-}" != "refs/heads/main" ]]; then
  echo "::error::Production head check must run on main."
  exit 1
fi

if [[ ! "${GITHUB_SHA:-}" =~ ^[0-9a-fA-F]{40}$ ]] || [[ -z "${GITHUB_OUTPUT:-}" ]]; then
  echo "::error::Missing GitHub Actions deployment context."
  exit 1
fi

# No logs or output from git, so repository transport credentials do not enter CI.
remote_head="$(git ls-remote --exit-code origin refs/heads/main | awk '{print $1}')"
if [[ ! "$remote_head" =~ ^[0-9a-fA-F]{40}$ ]]; then
  echo "::error::Cannot verify main HEAD: deployment blocked."
  exit 1
fi

if [[ "$remote_head" != "$GITHUB_SHA" ]]; then
  echo "::notice::Superseded main commit; skipping production steps."
  echo "current=false" >> "$GITHUB_OUTPUT"
else
  echo "current=true" >> "$GITHUB_OUTPUT"
fi
