#!/bin/sh
set -eu
mkdir -p /tmp/project
mkdir -p "$XDG_DATA_HOME" "$XDG_CONFIG_HOME" "$XDG_CACHE_HOME"
mkdir -p "$XDG_DATA_HOME/godot/export_templates/4.3.stable"
cp /opt/godot-templates/templates/web_*.zip "$XDG_DATA_HOME/godot/export_templates/4.3.stable/"
cp -R /src/. /tmp/project/
if [ -n "${GODOT_PROJECT_DIRECTORY:-}" ]; then
  project_dir="/tmp/project/$GODOT_PROJECT_DIRECTORY"
else
  project_file="$(find /tmp/project -type f -name project.godot -print -quit)"
  test -n "$project_file"
  project_dir="$(dirname "$project_file")"
fi
case "$project_dir" in /tmp/project|/tmp/project/*) ;; *) echo "Invalid project directory" >&2; exit 2 ;; esac
: "${GODOT_EXPORT_PRESET:?Godot Web export preset was not selected during preflight}"
mkdir -p /out
godot --headless --editor --path "$project_dir" --import
godot --headless --path "$project_dir" --export-release "$GODOT_EXPORT_PRESET" /out/index.html
test -s /out/index.html
