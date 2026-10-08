#!/usr/bin/env bash
set -Eeuo pipefail
rm -f examples/godot-demo.zip
(cd examples/godot-demo && zip -qr ../godot-demo.zip .)
rm -f examples/sdl-demo.zip examples/sdl-invalid.zip
(cd examples/sdl-demo && zip -qr ../sdl-demo.zip .)
(cd examples/sdl-invalid && zip -qr ../sdl-invalid.zip .)
