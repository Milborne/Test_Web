#!/usr/bin/env bash
set -u

printf '%s\n\n' "Game2Web environment check"
missing=0

check() {
  local label="$1"
  local command="$2"
  if command -v "$command" >/dev/null 2>&1; then
    printf '✓ %-18s %s\n' "$label" "$("$command" --version 2>&1 | head -n 1)"
  else
    printf '✗ %-18s not installed\n' "$label"
    missing=1
  fi
}

check "Node" node
check "npm" npm
check "Docker" docker
if docker compose version >/dev/null 2>&1; then
  printf '✓ %-18s %s\n' "Docker Compose" "$(docker compose version)"
else
  printf '✗ %-18s not available\n' "Docker Compose"
  missing=1
fi
check "Git" git

if [ "$missing" -ne 0 ]; then
  printf '\nCannot run E2E validation: install every required dependency first.\n' >&2
  exit 1
fi
printf '\nEnvironment ready.\n'
