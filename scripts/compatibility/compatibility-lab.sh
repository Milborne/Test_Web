#!/usr/bin/env bash
set -Eeuo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
REPORT_ROOT="${COMPATIBILITY_REPORT_DIR:-$ROOT/tests/compatibility/reports}"
WORKSPACE="${COMPATIBILITY_WORKSPACE:-$(mktemp -d "${TMPDIR:-/tmp}/game2web-compatibility.XXXXXX")}"
MANIFEST="${COMPATIBILITY_MANIFEST:-$ROOT/tests/compatibility/external-projects.yml}"
API_URL="${API_URL:-http://127.0.0.1:4000}"
APP_URL="${APP_URL:-http://127.0.0.1:3000}"
mkdir -p "$REPORT_ROOT" "$WORKSPACE"
RESULTS="$REPORT_ROOT/results.yml"
LICENSES="$REPORT_ROOT/licenses.md"
METADATA="$WORKSPACE/projects.tsv"
TMP_REPORT="$WORKSPACE/results.tmp"
: > "$TMP_REPORT"

cleanup() {
  rm -rf "$WORKSPACE"
}
trap cleanup EXIT

fetch_metadata="$("$ROOT/scripts/compatibility/fetch-external-projects.sh" "$MANIFEST" "$WORKSPACE")"
[ -f "$fetch_metadata" ]

cat > "$LICENSES" <<'EOF'
# Compatibility Lab License Report

This report records upstream declarations; it is not a legal opinion.

| Project | Repository | Commit | Code license | Asset license | Attribution | Redistribution |
|---|---|---|---|---|---|---|
EOF

printf '%s\n' "GAME2WEB COMPATIBILITY LAB" | tee "$REPORT_ROOT/summary.txt"
printf '%s\n' "Generated: $(date -u +%Y-%m-%dT%H:%M:%SZ)" >> "$REPORT_ROOT/summary.txt"

json_field() {
  node -e 'const fs=require("fs"); const value=JSON.parse(fs.readFileSync(0,"utf8")); let v=value; for (const key of process.argv.slice(1)) v=v?.[key]; process.stdout.write(v == null ? "" : String(v));' "$@"
}

register() {
  local cookie="$1"
  curl --fail --silent --show-error -c "$cookie" -b "$cookie" \
    -H 'content-type: application/json' \
    -d "{\"email\":\"compatibility-$(date +%s%N)@example.test\",\"password\":\"compatibility-lab-password\"}" \
    "$API_URL/api/auth/register" > "$WORKSPACE/auth.json"
  curl --fail --silent --show-error -b "$cookie" "$API_URL/health" >/dev/null
  csrf="$(awk '$6 == "game2web_csrf" { print $7 }' "$cookie")"
  [ -n "$csrf" ]
}

cookie="$WORKSPACE/cookies.txt"
register "$cookie"

while IFS=$'\t' read -r id repository commit branch license_file project_dir; do
  [ -n "$id" ] || continue
  started="$(date +%s)"
  project_report="$REPORT_ROOT/$id"
  mkdir -p "$project_report"
  version="$(grep -Eo 'config/features=["'\''][^"'\'']*' "$project_dir/project.godot" 2>/dev/null | head -1 | sed -E 's/.*(4\.[0-9]+|3\.[0-9]+).*/\1/' || true)"
  [ -n "$version" ] || version="unknown"
  license_text="not-found"
  [ -n "$license_file" ] && license_text="$(head -1 "$project_dir/$license_file" | tr -d '\r' || true)"
  printf '| %s | %s | `%s` | %s | %s | Verify upstream README | Not published automatically |\n' "$id" "$repository" "$commit" "$license_text" "See upstream" >> "$LICENSES"

  git -C "$project_dir" archive --format=zip --output="$project_report/source.zip" HEAD
  response="$(curl --fail --silent --show-error -b "$cookie" -H "x-csrf-token: $csrf" \
    -F "name=$id" -F "archive=@$project_report/source.zip;type=application/zip" \
    "$API_URL/api/projects")" || response=""
  project_id="$(printf '%s' "$response" | json_field project id || true)"
  provider="$(printf '%s' "$response" | json_field compatibility provider || true)"
  compatible="$(printf '%s' "$response" | json_field compatibility compatible || true)"
  build_status="NOT_RUN"
  artifacts_status="NOT_RUN"
  player_status="NOT_RUN"
  result="UNSUPPORTED"
  warnings=""
  errors=""

  if [ "$provider" = "godot" ] && [[ "$version" == 3.* ]]; then
    result="UNSUPPORTED"
    warnings="Godot 3.x is outside the pinned Godot 4 builder compatibility range"
  elif [ "$provider" = "godot" ] && [ "$compatible" = "true" ]; then
    build_response="$(curl --fail --silent --show-error -b "$cookie" -H "x-csrf-token: $csrf" \
      -H 'content-type: application/json' -d '{}' "$API_URL/api/projects/$project_id/builds" || true)"
    build_id="$(printf '%s' "$build_response" | json_field id || true)"
    if [ -n "$build_id" ]; then
      for _ in $(seq 1 180); do
        status_json="$(curl --fail --silent --show-error -b "$cookie" "$API_URL/api/builds/$build_id")"
        status="$(printf '%s' "$status_json" | json_field status)"
        case "$status" in READY|FAILED) break;; esac
        sleep 2
      done
      if [ "$status" = "READY" ]; then
        build_status="PASS"
        index_size="$(printf '%s' "$status_json" | node -e 'const fs=require("fs"); const x=JSON.parse(fs.readFileSync(0)); const a=x.artifacts?.find(a=>a.path==="index.html"); process.stdout.write(a?.size>0?"1":"0")')"
        if [ "$index_size" = "1" ]; then artifacts_status="PASS"; else artifacts_status="FAIL"; errors="index.html missing or empty"; fi
        if [ "$artifacts_status" = "PASS" ]; then
          slug="$(printf '%s' "$status_json" | json_field project slug)"
          if curl --fail --silent --show-error "$API_URL/api/play/$slug/" | grep -q '<' \
            && node "$ROOT/scripts/compatibility/player-check.mjs" "$APP_URL" "$slug"; then
            player_status="PASS"
          else
            player_status="FAIL"
            errors="temporary player did not return published HTML"
          fi
        fi
      else
        build_status="FAIL"
        errors="$(printf '%s' "$status_json" | json_field error || true)"
      fi
    else
      build_status="FAIL"
      errors="build was not queued"
    fi
    if [ "$build_status" = "PASS" ] && [ "$artifacts_status" = "PASS" ] && [ "$player_status" = "PASS" ]; then
      result="SUPPORTED"
    elif [ "$build_status" = "PASS" ] && [ "$artifacts_status" = "PASS" ]; then
      result="PLAYER_FAILED"
    elif [ "$build_status" = "FAIL" ]; then
      result="BUILD_FAILED"
    else
      result="SUPPORTED_WITH_WARNINGS"
    fi
  fi

  duration="$(( $(date +%s) - started ))"
  cat >> "$TMP_REPORT" <<EOF
  - project: $id
    repository: $repository
    commit: $commit
    branch: ${branch:-detached}
    engine: godot
    detected_version: "$version"
    provider: ${provider:-unknown}
    compatibility: $result
    build: $build_status
    artifacts: $artifacts_status
    player: $player_status
    duration_seconds: $duration
    warnings: []
    warnings: ["${warnings//\"/\\\"}"]
    errors: ["${errors//\"/\\\"}"]
EOF
  {
    printf '\n%s\n' "$id"
    printf '  Godot: %s\n  Build: %s\n  Artifacts: %s\n  Player: %s\n  Result: %s\n' "$version" "$build_status" "$artifacts_status" "$player_status" "$result"
  } | tee -a "$REPORT_ROOT/summary.txt"
done < "$METADATA"

{
  printf 'generated_at: %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  printf 'game2web_commit: %s\n' "$(git -C "$ROOT" rev-parse HEAD)"
  printf 'results:\n'
  cat "$TMP_REPORT"
} > "$RESULTS"
