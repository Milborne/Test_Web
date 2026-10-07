# Supported projects

Game2Web currently supports:

- Godot projects with a `project.godot` file and Web export settings;
- C/C++ projects using SDL2 through Emscripten, with the required
  `game2web.yml`, CMake project, and web runtime artifacts.

The SDL provider is demonstrated by `examples/sdl-demo`. Unity, Unreal, and
DOS projects are detected as unavailable and are not queued for builds.
