#!/usr/bin/env bash
set -Eeuo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
MANIFEST="${1:-$ROOT/tests/compatibility/external-projects.yml}"
WORKSPACE="${2:-${COMPATIBILITY_WORKSPACE:-$(mktemp -d "${TMPDIR:-/tmp}/game2web-compatibility.XXXXXX")}}"
METADATA="$WORKSPACE/projects.tsv"
mkdir -p "$WORKSPACE"
: > "$METADATA"

cleanup_on_error() {
  printf 'Compatibility fetch failed; temporary workspace retained at %s\n' "$WORKSPACE" >&2
}
trap cleanup_on_error ERR

while IFS=$'\t' read -r id repository requested_commit code_license asset_license redistribution_status attribution; do
  [ -n "$id" ] || continue
  if [ -n "${COMPATIBILITY_PROJECTS:-}" ] && [ "${COMPATIBILITY_PROJECTS}" != "all" ]; then
    case ",${COMPATIBILITY_PROJECTS}," in *,"$id",*) ;; *) continue ;; esac
  fi
  project_dir="$WORKSPACE/upstream/$id"
  mkdir -p "$(dirname "$project_dir")"
  git clone --quiet --no-tags "$repository" "$project_dir"
  requested_commit="${requested_commit:-}"
  if [ -n "$requested_commit" ]; then
    git -C "$project_dir" fetch --quiet origin "$requested_commit"
    git -C "$project_dir" checkout --quiet --detach "$requested_commit"
  fi
  commit="$(git -C "$project_dir" rev-parse HEAD)"
  if [ -n "$requested_commit" ] && [ "$commit" != "$requested_commit" ]; then
    printf 'Requested commit mismatch for %s: expected=%s actual=%s\n' "$id" "$requested_commit" "$commit" >&2
    exit 1
  fi
  verified="$(git -C "$project_dir" rev-parse HEAD)"
  [ "$commit" = "$verified" ]
  branch="$(git -C "$project_dir" branch --show-current)"
  [ -n "$branch" ] || branch="detached"
  license_file="$(find "$project_dir" -maxdepth 2 -type f \( -iname 'license' -o -iname 'license.*' -o -iname 'copying' -o -iname 'copying.*' \) -print -quit | sed "s#^$project_dir/##")"
  [ -n "$license_file" ] || license_file="not-found"
  printf '%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\n' "$id" "$repository" "$commit" "$branch" "$license_file" "$project_dir" "${code_license:-unknown}" "${asset_license:-unknown}" "${redistribution_status:-LICENSE_REVIEW_REQUIRED}" "${attribution:-not-recorded}" >> "$METADATA"
done < <(awk '
  function emit() {
    if (id != "" && repository != "") print id "\t" repository "\t" commit "\t" code_license "\t" asset_license "\t" redistribution_status "\t" attribution
  }
  /^[[:space:]]*-[[:space:]]+id:/ { emit(); id=$0; sub(/^.*id:[[:space:]]*/, "", id); repository=""; commit=""; code_license=""; asset_license=""; redistribution_status=""; attribution=""; next }
  /^[[:space:]]+repository:/ { repository=$0; sub(/^[^:]*:[[:space:]]*/, "", repository); gsub(/"/, "", repository); next }
  /^[[:space:]]+commit:/ { commit=$0; sub(/^[^:]*:[[:space:]]*/, "", commit); gsub(/"/, "", commit); next }
  /^[[:space:]]+(license|code_license):/ { code_license=$0; sub(/^[^:]*:[[:space:]]*/, "", code_license); gsub(/"/, "", code_license); next }
  /^[[:space:]]+asset_license:/ { asset_license=$0; sub(/^[^:]*:[[:space:]]*/, "", asset_license); gsub(/"/, "", asset_license); next }
  /^[[:space:]]+redistribution_status:/ { redistribution_status=$0; sub(/^[^:]*:[[:space:]]*/, "", redistribution_status); gsub(/"/, "", redistribution_status); next }
  /^[[:space:]]+attribution:/ { attribution=$0; sub(/^[^:]*:[[:space:]]*/, "", attribution); gsub(/"/, "", attribution); next }
  END { emit() }
' "$MANIFEST")

printf '%s\n' "$METADATA"
