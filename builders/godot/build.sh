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
if [ "${GODOT_GENERATE_WEB_PRESET:-0}" = "1" ]; then
  if [ -f "$project_dir/export_presets.cfg" ]; then
    echo "Refusing to replace source export_presets.cfg" >&2
    exit 2
  fi
  cat > "$project_dir/export_presets.cfg" <<'EOF'
[preset.0]
name="Game2Web Web"
platform="Web"
runnable=true
custom_features=""
export_filter="all_resources"
include_filter=""
exclude_filter=""
export_path=""

[preset.0.options]
variant/thread_support=false
variant/gzip=false
html/canvas_resize_policy=2
html/experimental_virtual_keyboard=false
progressive_web_app/ensure_cross_origin_isolation_headers=true
EOF
  echo "Generated temporary Web export preset"
fi
if [ "${GODOT_USE_COMPATIBILITY_RENDERER:-0}" = "1" ]; then
  project_config="$project_dir/project.godot"
  test -f "$project_config"
  awk '
    BEGIN { in_rendering=0; found_rendering=0 }
    /^\[rendering\][[:space:]]*$/ {
      if (in_rendering) print "renderer/rendering_method=\"gl_compatibility\"\nrenderer/rendering_method.mobile=\"gl_compatibility\""
      in_rendering=1
      found_rendering=1
      print
      next
    }
    /^\[/ {
      if (in_rendering) {
        print "renderer/rendering_method=\"gl_compatibility\"\nrenderer/rendering_method.mobile=\"gl_compatibility\""
        in_rendering=0
      }
      print
      next
    }
    in_rendering && /^renderer\/rendering_method(\.mobile)?[[:space:]]*=/ { next }
    { print }
    END {
      if (in_rendering) print "renderer/rendering_method=\"gl_compatibility\"\nrenderer/rendering_method.mobile=\"gl_compatibility\""
      if (!found_rendering) print "\n[rendering]\nrenderer/rendering_method=\"gl_compatibility\"\nrenderer/rendering_method.mobile=\"gl_compatibility\""
    }
  ' "$project_config" > "$project_config.tmp"
  mv "$project_config.tmp" "$project_config"
  echo "Applied temporary Compatibility renderer setting"
fi
mkdir -p /out
godot --headless --editor --path "$project_dir" --import
godot --headless --path "$project_dir" --export-release "$GODOT_EXPORT_PRESET" /out/index.html
test -s /out/index.html
