# Emscripten + SDL provider

The `emscripten-sdl` provider builds a C or C++ project that uses SDL2 for the
browser through the pinned Emscripten builder image. A supported project must
contain:

- `game2web.yml` with `build.provider: emscripten-sdl`;
- a root `CMakeLists.txt`;
- at least one C/C++ source file;
- an executable that emits `index.html`, JavaScript, and WebAssembly.

The builder uses Emscripten's built-in SDL2 port (`-sUSE_SDL=2`). It has no
network access during a build and does not execute commands supplied by the
project manifest. The manifest is descriptive configuration only; CMake is
invoked by the trusted builder script.

The reference project is `examples/sdl-demo`. It includes a canvas-based SDL
game, a `#game-ready` runtime signal, keyboard input, and mouse input. Projects
that only contain arbitrary C/C++ or an incomplete manifest are rejected before
they enter the build queue.
