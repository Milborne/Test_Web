#!/usr/bin/env bash
set -Eeuo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
REPORT_DIR="$ROOT/.validation"
REPORT="$REPORT_DIR/report.txt"
mkdir -p "$REPORT_DIR"
: > "$REPORT"
export DATABASE_URL="${DATABASE_URL:-postgresql://game2web:game2web@localhost:5432/game2web}"
export REDIS_URL="${REDIS_URL:-redis://localhost:6379}"
export S3_ENDPOINT="${S3_ENDPOINT:-http://localhost:9000}"
export NEXT_PUBLIC_API_URL="${NEXT_PUBLIC_API_URL:-http://127.0.0.1:4000}"
export NEXT_PUBLIC_PLAYER_ORIGIN="${NEXT_PUBLIC_PLAYER_ORIGIN:-http://localhost:4000}"
CURRENT_STAGE="startup"
api_pid=""
worker_pid=""
web_pid=""
log=""

cleanup() {
  for pid in "$api_pid" "$worker_pid" "$web_pid"; do
    if [ -n "$pid" ]; then kill "$pid" 2>/dev/null || true; fi
  done
}
trap cleanup EXIT
trap 'printf "\nFINAL RESULT:\nNOT VALIDATED\nFailed stage: %s\n" "${CURRENT_STAGE:-unknown}" | tee -a "$REPORT"; for log in "$REPORT_DIR"/*.log; do [ -f "$log" ] && { printf "\n--- %s ---\n" "$log"; cat "$log"; }; done' ERR

record() { printf '%-24s PASS\n' "$1" | tee -a "$REPORT"; }
run_stage() { CURRENT_STAGE="$1"; shift; "$@"; record "$CURRENT_STAGE"; }

printf 'GAME2WEB E2E VALIDATION\n\n' | tee "$REPORT"
run_stage "Environment" "$ROOT/scripts/check-env.sh"
run_stage "Dependencies" npm install --no-audit --no-fund
run_stage "Typecheck" npm run typecheck
run_stage "Lint" npm run lint
run_stage "Unit tests" npm test
run_stage "Workspace build" npm run build
run_stage "Godot 4.3 builder image" docker build --file "$ROOT/builders/godot/Dockerfile" --tag game2web/godot-builder:4.3.0 "$ROOT"
run_stage "Godot 4.4 builder image" docker build --file "$ROOT/builders/godot-4.4/Dockerfile" --tag game2web/godot-builder:4.4.0 "$ROOT"
run_stage "Emscripten builder image" docker build --tag "game2web/emscripten-builder:${EMSCRIPTEN_VERSION:-3.1.74}" "$ROOT/builders/emscripten"
run_stage "Database migrations" npx prisma db push --schema "$ROOT/packages/database/prisma/schema.prisma"

CURRENT_STAGE="Infrastructure"
curl --fail --silent http://127.0.0.1:9000/minio/health/live >/dev/null
docker compose -f "$ROOT/infra/docker-compose.yml" exec -T redis redis-cli ping | grep -q PONG
docker compose -f "$ROOT/infra/docker-compose.yml" exec -T postgres pg_isready -U game2web -d game2web >/dev/null
record "PostgreSQL"
record "Redis"
record "MinIO"

CURRENT_STAGE="Application startup"
npm run dev --workspace apps/api >"$REPORT_DIR/api.log" 2>&1 &
api_pid=$!
npm run dev --workspace apps/worker >"$REPORT_DIR/worker.log" 2>&1 &
worker_pid=$!
npm run dev --workspace apps/web >"$REPORT_DIR/web.log" 2>&1 &
web_pid=$!
for _ in $(seq 1 60); do
  if curl --fail --silent http://127.0.0.1:4000/health >/dev/null && curl --fail --silent http://127.0.0.1:3000 >/dev/null; then break; fi
  sleep 1
done
curl --fail --silent http://127.0.0.1:4000/health >/dev/null
curl --fail --silent http://127.0.0.1:3000 >/dev/null
record "API and player"
run_stage "E2E fixture" npm run prepare:e2e
run_stage "M7 infrastructure checks" env REPORT_DIR="$REPORT_DIR" "$ROOT/scripts/validate-m7.sh"

CURRENT_STAGE="Browser E2E"
npm run e2e 2>&1 | tee "$REPORT_DIR/playwright.log"
record "Upload"
record "Provider detection"
record "Compatibility"
record "BullMQ worker"
record "Godot build"
record "Emscripten SDL build"
record "Artifact validation"
record "Deployment"
record "Player"
record "Failure E2E"

cat <<'EOF' | tee -a "$REPORT"

FINAL RESULT:
MULTI-ENGINE MVP VALIDATED
EOF
