#!/usr/bin/env bash
set -Eeuo pipefail

for file in builders/*/Dockerfile; do
  grep -Eq '^FROM [^ ]+:[0-9][^ ]+@sha256:[0-9a-f]{64}$' "$file" || {
    printf 'Builder base image must use an exact version tag and SHA-256 digest: %s\n' "$file" >&2
    exit 1
  }
  if grep -Eq '^FROM .*:latest([[:space:]]|$)' "$file"; then
    printf 'Floating latest builder image: %s\n' "$file" >&2
    exit 1
  fi
done
grep -q 'MINIO_IMAGE' infra/docker-compose.yml
grep -q 'Godot_v4.4-stable_export_templates' builders/godot-4.4/Dockerfile
grep -q 'sha512sum --check' builders/godot-4.4/Dockerfile
printf 'Image policy PASS (builder base images are pinned by version and digest)\n'
