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

while IFS=$'\t' read -r id repository requested_commit; do
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
  license_file="$(find "$project_dir" -maxdepth 2 -type f \( -iname 'license' -o -iname 'license.*' -o -iname 'copying' -o -iname 'copying.*' \) -print -quit | sed "s#^$project_dir/##" || true)"
  printf '%s\t%s\t%s\t%s\t%s\t%s\n' "$id" "$repository" "$commit" "$branch" "$license_file" "$project_dir" >> "$METADATA"
done < <(awk '
  function emit() {
    if (id != "" && repository != "") print id "\t" repository "\t" commit
  }
  /^[[:space:]]*-[[:space:]]+id:/ { emit(); id=$0; sub(/^.*id:[[:space:]]*/, "", id); repository=""; commit=""; next }
  /^[[:space:]]+repository:/ { repository=$0; sub(/^.*repository:[[:space:]]*/, "", repository); gsub(/"/, "", repository); next }
  /^[[:space:]]+commit:/ { commit=$0; sub(/^.*commit:[[:space:]]*/, "", commit); gsub(/"/, "", commit); next }
  END { emit() }
' "$MANIFEST")

printf '%s\n' "$METADATA"
