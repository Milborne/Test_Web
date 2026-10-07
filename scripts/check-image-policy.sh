#!/usr/bin/env bash
set -Eeuo pipefail

for file in builders/*/Dockerfile; do
  grep -Eq '^FROM [^ ]+:[0-9][^ ]*$' "$file" || {
    printf 'Builder image must use an exact version tag: %s\n' "$file" >&2
    exit 1
  }
  if grep -Eq '^FROM .*:latest([[:space:]]|$)' "$file"; then
    printf 'Floating latest builder image: %s\n' "$file" >&2
    exit 1
  fi
done
grep -q 'MINIO_IMAGE' infra/docker-compose.yml
printf 'Image policy PASS (builder versions are immutable tags; promote digests before beta)\n'
