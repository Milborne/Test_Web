# Supported projects

Game2Web currently supports:

- Godot 4.3 projects with a `project.godot`, exactly one runnable Web export
  preset, and the Compatibility renderer;
- C/C++ projects using SDL2 through Emscripten, with the required
  `game2web.yml`, CMake project, and web runtime artifacts.

The SDL provider is demonstrated by `examples/sdl-demo`. Unity, Unreal, and
DOS projects are detected as unavailable and are not queued for builds.

Godot 3 projects are unsupported. Godot 4 projects for versions without a
matching pinned builder, missing/ambiguous Web presets, Forward renderers,
missing referenced resources, native extensions, and FBX assets requiring the
unavailable FBX2glTF converter are reported as `REQUIRES_ADAPTATION` before
build. Godot preflight is static and does not execute project scripts or
plugins. See [Godot provider compatibility](../providers/godot.md) for the
version policy, export requirements, and diagnostic limits.
