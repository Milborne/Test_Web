#!/usr/bin/env bash
set -Eeuo pipefail

API_URL="${API_URL:-http://127.0.0.1:4000}"
APP_ORIGIN="${APP_ORIGIN:?APP_ORIGIN must be set}"
PLAYER_ORIGIN="${PLAYER_ORIGIN:?PLAYER_ORIGIN must be set}"
UNKNOWN_ORIGIN="${UNKNOWN_ORIGIN:-https://unknown.example.test}"
REPORT_DIR="${REPORT_DIR:-.validation}"
admission_pid=""
admission_dir=""

cleanup() {
  if [ -n "$admission_pid" ]; then
    kill "$admission_pid" 2>/dev/null || true
  fi
  if [ -n "$admission_dir" ]; then
    rm -rf "$admission_dir"
  fi
}
trap cleanup EXIT

if [ "$APP_ORIGIN" = "$PLAYER_ORIGIN" ]; then
  printf 'APP_ORIGIN and PLAYER_ORIGIN must be different for M7 validation\n' >&2
  exit 1
fi

readiness="$(curl --fail --silent --show-error "$API_URL/readiness")"
printf '%s' "$readiness" | grep -q '"status":"ready"'

check_cors() {
  local origin="$1"
  local expected="$2"
  local headers
  headers="$(curl --silent --show-error -D - -o /dev/null -H "Origin: $origin" "$API_URL/api/auth/me")"
  if [ "$expected" = "allow" ]; then
    printf '%s' "$headers" | grep -Fqi "access-control-allow-origin: $origin"
    printf '%s' "$headers" | grep -Fqi "access-control-allow-credentials: true"
  else
    if printf '%s' "$headers" | grep -Fqi "access-control-allow-origin:"; then
      printf 'Unexpected CORS permission for %s\n' "$origin" >&2
      exit 1
    fi
  fi
}

check_cors "$APP_ORIGIN" allow
check_cors "$PLAYER_ORIGIN" deny
check_cors "$UNKNOWN_ORIGIN" deny

cookie_headers="$(curl --fail --silent --show-error -D - -o /dev/null \
  -H 'content-type: application/json' \
  --data "{\"email\":\"m7-cookie-check-$(date +%s%N)@example.test\",\"password\":\"correct horse battery\"}" \
  "$API_URL/api/auth/register")"
printf '%s' "$cookie_headers" | grep -Fqi 'set-cookie: game2web_session='
printf '%s' "$cookie_headers" | grep -Fqi 'set-cookie: game2web_csrf='
if printf '%s' "$cookie_headers" | grep -Eqi 'set-cookie:.*(Domain=|Domain\s*=)'; then
  printf 'Authentication cookies must remain host-only\n' >&2
  exit 1
fi

private_status="$(curl --silent --show-error -o /dev/null -w '%{http_code}' \
  -H "Origin: $PLAYER_ORIGIN" "$API_URL/api/projects")"
[ "$private_status" = "401" ]

unpublished_status="$(curl --silent --show-error -o /dev/null -w '%{http_code}' "$API_URL/api/play/m7-not-published/")"
[ "$unpublished_status" = "404" ]

admission_dir="$(mktemp -d)"
API_PORT=4001 BUILD_MIN_FREE_DISK_MB=999999999 npm run dev --workspace apps/api >"$REPORT_DIR/api-admission.log" 2>&1 &
admission_pid=$!
for _ in $(seq 1 30); do
  if curl --fail --silent "http://127.0.0.1:4001/health" >/dev/null; then break; fi
  sleep 1
done
curl --fail --silent "http://127.0.0.1:4001/health" >/dev/null
cookie_file="$admission_dir/cookies.txt"
curl --fail --silent --show-error -c "$cookie_file" \
  -H 'content-type: application/json' \
  --data "{\"email\":\"m7-admission-$(date +%s%N)@example.test\",\"password\":\"correct horse battery\"}" \
  "http://127.0.0.1:4001/api/auth/register" >/dev/null
admission_csrf="$(awk '$6 == "game2web_csrf" { print $7 }' "$cookie_file")"
admission_project="$(curl --fail --silent --show-error -b "$cookie_file" \
  -H "x-csrf-token: $admission_csrf" \
  -F 'name=godot-admission' \
  -F 'redistributionStatus=REDISTRIBUTION_CLEARED' \
  -F 'archive=@examples/godot-demo.zip;type=application/zip' \
  "http://127.0.0.1:4001/api/projects")"
admission_project_id="$(printf '%s' "$admission_project" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>process.stdout.write(JSON.parse(s).project.id))')"
admission_status="$(curl --silent --show-error -o /dev/null -w '%{http_code}' -b "$cookie_file" \
  -H "x-csrf-token: $admission_csrf" -H 'content-type: application/json' \
  --data '{}' "http://127.0.0.1:4001/api/projects/$admission_project_id/builds")"
[ "$admission_status" = "503" ]

printf 'M7 runtime checks PASS\n'
