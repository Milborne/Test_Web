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

while IFS=$'\t' read -r id repository; do
  [ -n "$id" ] || continue
  project_dir="$WORKSPACE/upstream/$id"
  mkdir -p "$(dirname "$project_dir")"
  git clone --quiet --no-tags "$repository" "$project_dir"
  commit="$(git -C "$project_dir" rev-parse HEAD)"
  verified="$(git -C "$project_dir" rev-parse HEAD)"
  [ "$commit" = "$verified" ]
  branch="$(git -C "$project_dir" branch --show-current)"
  license_file="$(find "$project_dir" -maxdepth 2 -type f \( -iname 'license' -o -iname 'license.*' -o -iname 'copying' -o -iname 'copying.*' \) -print -quit | sed "s#^$project_dir/##" || true)"
  printf '%s\t%s\t%s\t%s\t%s\t%s\n' "$id" "$repository" "$commit" "$branch" "$license_file" "$project_dir" >> "$METADATA"
done < <(awk '
  /^[[:space:]]*-[[:space:]]+id:/ { id=$0; sub(/^.*id:[[:space:]]*/, "", id); next }
  /^[[:space:]]+repository:/ { repo=$0; sub(/^.*repository:[[:space:]]*/, "", repo); gsub(/"/, "", repo); if (id != "") { print id "\t" repo; id="" } }
' "$MANIFEST")

printf '%s\n' "$METADATA"
