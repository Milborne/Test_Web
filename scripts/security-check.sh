#!/usr/bin/env bash
set -Eeuo pipefail

providers="packages/providers/src/index.ts"
worker="apps/worker/src/worker.ts"
compose="infra/docker-compose.yml"

grep -q -- '--network=none' "$providers"
grep -q -- '--cap-drop=ALL' "$providers"
grep -q -- 'no-new-privileges:true' "$providers"
grep -q -- '--pids-limit' "$providers"
grep -q -- '--read-only' "$providers"
! grep -q -- '/var/run/docker.sock' "$providers" "$worker"
grep -q 'segments.some((segment) => segment === "..")' apps/api/src/server.ts
grep -q 'Source archive exceeds expansion safety limits' "$worker"
grep -q '127.0.0.1:' "$compose"

printf 'Security assertions PASS\n'
