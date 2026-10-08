# Supported projects

Game2Web currently supports:

- Godot projects accepted by the explicitly versioned Godot builder matrix,
  with one runnable Web export preset or a safe, temporary 2D adaptation;
- C/C++ projects using SDL2 through Emscripten, with the required
  `game2web.yml`, CMake project, and web runtime artifacts.

The SDL provider is demonstrated by `examples/sdl-demo`. Unity, Unreal, and
DOS projects are detected as unavailable and are not queued for builds.

Godot 3 projects are unsupported. Godot 4.3 and 4.4 have separate builders;
versions without an explicitly compatible pinned builder, and projects with an undetectable version, are
reported as `REQUIRES_BUILDER`. Missing resources, unsafe renderer changes,
native extensions, and FBX assets requiring the unavailable FBX2glTF converter
are reported as `REQUIRES_ADAPTATION` before build. The M9.3 Godot 4.0-to-4.3
allow-list has passed an external build and player runtime check.
Godot preflight is static and does not execute project scripts or plugins. See
[Godot provider compatibility](../providers/godot.md) for version policy,
export requirements, and diagnostic limits.

New uploads default to `LICENSE_REVIEW_REQUIRED`. Production builds are blocked
until the owner explicitly attests that redistribution rights for the code and
assets have been checked. Preview builds do not clear this status and do not
create a production deployment.
