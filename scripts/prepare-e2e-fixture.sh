#!/usr/bin/env bash
set -Eeuo pipefail
rm -f examples/godot-demo.zip
(cd examples/godot-demo && zip -qr ../godot-demo.zip .)
