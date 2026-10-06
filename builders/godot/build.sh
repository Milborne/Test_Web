#!/bin/sh
set -eu
mkdir -p /tmp/project
mkdir -p "$XDG_DATA_HOME" "$XDG_CONFIG_HOME" "$XDG_CACHE_HOME"
cp -R /src/. /tmp/project/
project_file="$(find /tmp/project -type f -name project.godot -print -quit)"
test -n "$project_file"
project_dir="$(dirname "$project_file")"
mkdir -p /out
godot --headless --path "$project_dir" --export-release Web /out/index.html
test -s /out/index.html
