#!/bin/sh
set -eu
test -f CMakeLists.txt
test -f game2web.yml
grep -Eq '^build:[[:space:]]*$' game2web.yml
grep -Eq '^[[:space:]]+provider:[[:space:]]*emscripten-sdl[[:space:]]*$' game2web.yml
mkdir -p /tmp/game2web-build /out
emcmake cmake -S /src -B /tmp/game2web-build -G Ninja -DCMAKE_BUILD_TYPE=Release -DCMAKE_RUNTIME_OUTPUT_DIRECTORY=/out
cmake --build /tmp/game2web-build
test -f /out/index.html
