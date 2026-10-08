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
required_project_seen=false
required_project="${COMPATIBILITY_REQUIRED_PROJECT:-}"

cleanup() {
  rm -rf "$WORKSPACE"
}
trap cleanup EXIT

fetch_metadata="$(bash "$ROOT/scripts/compatibility/fetch-external-projects.sh" "$MANIFEST" "$WORKSPACE")"
[ -f "$fetch_metadata" ]
[ -s "$fetch_metadata" ] || { printf 'No projects selected for Compatibility Lab\n' >&2; exit 1; }

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

yaml_quote() {
  node -e 'process.stdout.write(JSON.stringify(process.argv[1]))' "$1"
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
  license_text="not-found"
  [ "$license_file" = "not-found" ] || license_text="$(head -1 "$project_dir/$license_file" | tr -d '\r')"
  printf '%s\n' "| $id | $repository | \`$commit\` | $license_text | See upstream | Not published automatically |" >> "$LICENSES"

  source_archive="$WORKSPACE/$id-source.zip"
  git -C "$project_dir" archive --format=zip --output="$source_archive" HEAD
  warnings=""
  errors=""
  if ! response="$(curl --fail --silent --show-error -b "$cookie" -H "x-csrf-token: $csrf" \
    -F "name=$id" -F "archive=@$source_archive;type=application/zip" \
    "$API_URL/api/projects")"; then
    response=""
    errors="project upload failed"
  fi
  printf '%s\n' "$response" > "$project_report/upload.json"
  project_id="$(printf '%s' "$response" | json_field project id || true)"
  provider="$(printf '%s' "$response" | json_field compatibility provider || true)"
  compatible="$(printf '%s' "$response" | json_field compatibility compatible || true)"
  warnings="$(printf '%s' "$response" | json_field compatibility warnings || true)"
  preflight_status="$(printf '%s' "$response" | json_field compatibility preflight status || true)"
  preflight_ms="$(printf '%s' "$response" | json_field compatibility preflight durationMs || true)"
  version="$(printf '%s' "$response" | json_field compatibility preflight engineVersion raw || true)"
  builder_version="$(printf '%s' "$response" | json_field compatibility preflight builderVersion || true)"
  web_export_status="$(printf '%s' "$response" | json_field compatibility preflight webExportStatus || true)"
  [ -n "$version" ] || version="unknown"
  [ -n "$preflight_ms" ] || preflight_ms="0"
  [ -n "$builder_version" ] || builder_version="n/a"
  [ -n "$web_export_status" ] || web_export_status="n/a"
  build_status="NOT_RUN"
  artifacts_status="NOT_RUN"
  player_status="NOT_RUN"
  result="UNSUPPORTED"
  if [ -n "$required_project" ] && [ "$id" = "$required_project" ]; then
    required_project_seen=true
  fi

  if [ "$provider" = "godot" ] && { [ "$preflight_status" = "UNSUPPORTED" ] || [ "$preflight_status" = "REQUIRES_ADAPTATION" ] || [ "$preflight_status" = "REQUIRES_BUILDER" ]; }; then
    result="$preflight_status"
    errors="$(printf '%s' "$response" | json_field compatibility preflight errors || true)"
  elif [ -z "$provider" ]; then
    result="UPLOAD_FAILED"
    [ -n "$errors" ] || errors="$(printf '%s' "$response" | json_field error || true)"
  elif [ "$provider" = "godot" ] && [ "$compatible" = "true" ]; then
    if ! build_response="$(curl --fail --silent --show-error -b "$cookie" -H "x-csrf-token: $csrf" \
      -H 'content-type: application/json' -d '{}' "$API_URL/api/projects/$project_id/builds")"; then
      build_response=""
      errors="build request failed"
    fi
    printf '%s\n' "$build_response" > "$project_report/build-request.json"
    build_id="$(printf '%s' "$build_response" | json_field id || true)"
    if [ -n "$build_id" ]; then
      status=""
      status_json=""
      poll_error=""
      for _ in $(seq 1 180); do
        if ! status_json="$(curl --fail --silent --show-error -b "$cookie" "$API_URL/api/builds/$build_id")"; then
          poll_error="build status request failed"
          break
        fi
        printf '%s\n' "$status_json" > "$project_report/build.json"
        status="$(printf '%s' "$status_json" | json_field status)"
        case "$status" in READY|FAILED) break;; esac
        sleep 2
      done
      if [ -n "$poll_error" ]; then
        build_status="FAIL"
        errors="$poll_error"
      elif [ "$status" = "READY" ]; then
        build_status="PASS"
        index_size="$(printf '%s' "$status_json" | node -e 'const fs=require("fs"); const x=JSON.parse(fs.readFileSync(0)); const a=x.artifacts?.find(a=>a.path==="index.html"); process.stdout.write(a?.size>0?"1":"0")')"
        if [ "$index_size" = "1" ]; then artifacts_status="PASS"; else artifacts_status="FAIL"; errors="index.html missing or empty"; fi
        if [ "$artifacts_status" = "PASS" ]; then
          slug="$(printf '%s' "$status_json" | json_field project slug)"
          if curl --fail --silent --show-error "$API_URL/api/play/$slug/" | grep -q '<' \
            && node "$ROOT/scripts/compatibility/player-check.mjs" "$APP_URL" "$slug"; then
            if EXTERNAL_GAME_SLUG="$slug" npx playwright test "$ROOT/e2e/external-player.spec.ts" --reporter=line; then
              player_status="PASS"
            else
              player_status="FAIL"
              errors="external Playwright runtime validation failed"
            fi
          else
            player_status="FAIL"
            errors="temporary player did not return published HTML"
          fi
        fi
      else
        build_status="FAIL"
        errors="$(printf '%s' "$status_json" | json_field error || true)"
        [ -n "$errors" ] || errors="build did not reach READY within 6 minutes"
      fi
    else
      build_status="FAIL"
      [ -n "$errors" ] || errors="build was not queued"
    fi
    if [ "$build_status" = "PASS" ] && [ "$artifacts_status" = "PASS" ] && [ "$player_status" = "PASS" ]; then
      result="SUPPORTED"
    elif [ "$build_status" = "PASS" ] && [ "$artifacts_status" = "PASS" ]; then
      result="PLAYER_FAILED"
    elif [ "$build_status" = "PASS" ] && [ "$artifacts_status" = "FAIL" ]; then
      result="ARTIFACTS_FAILED"
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
    preflight_status: ${preflight_status:-NOT_AVAILABLE}
    preflight_duration_ms: $preflight_ms
    builder_version: "$builder_version"
    builder_image: $(yaml_quote "$(printf '%s' "$response" | json_field compatibility preflight builderImage || true)")
    builder_digest: $(yaml_quote "$(printf '%s' "$response" | json_field compatibility preflight builderDigest || true)")
    builder_base_digest: $(yaml_quote "$(printf '%s' "$response" | json_field compatibility preflight builderBaseImageDigest || true)")
    web_export_status: $web_export_status
    adaptations: [$(yaml_quote "$(printf '%s' "$response" | json_field compatibility preflight adaptations || true)")]
    source_commit: $commit
    warnings: [$(yaml_quote "$warnings")]
    errors: [$(yaml_quote "$errors")]
EOF
  {
    printf '\n%s\n' "$id"
    printf '  Godot: %s\n  Preflight: %s (%sms)\n  Builder: %s\n  Web export: %s\n  Build: %s\n  Artifacts: %s\n  Player: %s\n  Result: %s\n' "$version" "$preflight_status" "$preflight_ms" "$builder_version" "$web_export_status" "$build_status" "$artifacts_status" "$player_status" "$result"
  } | tee -a "$REPORT_ROOT/summary.txt"
done < "$METADATA"

if [ -n "$required_project" ] && [ "$required_project_seen" != "true" ]; then
  printf 'Required Compatibility Lab project was not fetched: %s\n' "$required_project" | tee -a "$REPORT_ROOT/summary.txt"
  exit 1
fi

{
  printf 'generated_at: %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  printf 'game2web_commit: %s\n' "$(git -C "$ROOT" rev-parse HEAD)"
  printf 'results:\n'
  cat "$TMP_REPORT"
} > "$RESULTS"

regression_status="PASS"
for baseline in "$ROOT"/tests/compatibility/baselines/*.yml; do
  [ -f "$baseline" ] || continue
  baseline_project="$(awk -F': ' '$1 == "project" { print $2; exit }' "$baseline")"
  baseline_result="$(awk -F': ' '$1 == "result" { print $2; exit }' "$baseline")"
  current_result="$(awk -v project="$baseline_project" '
    $0 ~ "project: " project "$" { found=1 }
    found && $1 == "compatibility:" { print $2; exit }
  ' "$RESULTS")"
  if [ "$baseline_result" = "SUPPORTED" ] && [ "$current_result" = "BUILD_FAILED" ]; then
    printf 'REGRESSION: %s previous=%s current=%s\n' "$baseline_project" "$baseline_result" "$current_result" | tee -a "$REPORT_ROOT/summary.txt"
    regression_status="FAIL"
  fi
done
printf 'Regression checks: %s\n' "$regression_status" | tee -a "$REPORT_ROOT/summary.txt"
[ "$regression_status" = "PASS" ]
if [ -n "$required_project" ]; then
  required_result="$(awk -v project="$required_project" '
    $0 ~ "project: " project "$" { found=1 }
    found && $1 == "compatibility:" { print $2; exit }
  ' "$RESULTS")"
  if [ "$required_result" != "SUPPORTED" ]; then
    printf 'Required project did not complete build, artifact, and player validation: %s (%s)\n' "$required_project" "${required_result:-NOT_REPORTED}" | tee -a "$REPORT_ROOT/summary.txt"
    exit 1
  fi
fi
