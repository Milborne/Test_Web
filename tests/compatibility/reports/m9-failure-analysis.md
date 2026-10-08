# M9.1 Failure Analysis

Run: [37712046826](https://github.com/Milbornee/Test_Web/actions/runs/37712046826)  
Game2Web commit: `c49633f4cd956b9c998dc49faf688c25d48c6f13`  
Builder image: `game2web/godot-builder:4.3.0`  
Build command: `godot --headless --path <project-dir> --export-release Web /out/index.html`  
Container policy: `--network=none`, non-root UID 1000, read-only root filesystem, resource limits.

## Failure matrix

| Project | Repository | Commit SHA | Detected/project version | Builder | Export preset evidence | Exit | First meaningful error | Category | Likely root cause |
|---|---|---|---|---|---|---:|---|---|---|
| Turn-based RPG | `corndogit/Turn-based_RPG` | `a5c8190278381cf4ddedd45c2958ca7f11228674` | Godot 4.0 (`PackedStringArray("4.0", "Forward Plus")`) | 4.3.0 | `export_presets.cfg` missing | 1 | `This project doesn't have an export_presets.cfg file at its root.` | `EXPORT_CONFIGURATION` | The project has no export presets, so the hard-coded `Web` preset cannot be selected. |
| Godot Runner | `hman278/Godot-Runner-Game` | `a84ec271d41b835a7da3778b4dbfe1edca1fa26d` | Legacy Godot format; no `config/features` entry; scripts use Godot 3 `Spatial` | 4.3.0 | `export_presets.cfg` missing | 1 | `Could not find base class "Spatial"`; followed by missing `export_presets.cfg` | `BUILDER_VERSION_MISMATCH` | The source uses Godot 3 APIs and has no Web export preset; it is not a Godot 4.3 Web build input. |
| Godot 2D Platformer | `SlayHorizon/godot-2d-platformer-demo` | `6944ec4c323dcbad470ff7654fec665f010f50d1` | Godot 4.4 (`PackedStringArray("4.4", "GL Compatibility")`) | 4.3.0 | Web preset exists as `name="html"` | 1 | `Unable to open file: res://.godot/imported/...ctex`; followed by failed loading of source textures | `BUILDER_VERSION_MISMATCH` | The project targets 4.4 and relies on imported resource state absent from the clean source archive; it was run through a 4.3 builder. |
| RoboBlast | `realkotob/ggj-2024` | `6dce46c955f312a0f74d91f3a5868cef317c3db8` | Godot 4.2 (`PackedStringArray("4.2", "Forward Plus")`) | 4.3.0 | Only `Windows Desktop`; no `Web` preset | 1 | `Invalid export preset name: Web. The following presets were detected ... "Windows Desktop"` | `EXPORT_CONFIGURATION` | The project has no Web export configuration. FBX importer errors (`FBX conversion to glTF failed with error: 127`) are an additional asset/import failure. |
| GDQuest A-RPG | `gdquest-demos/godot-make-pro-2d-games` | `7290681309ffcd700c2c08a8e59a57bfbec14d5e` | Godot 3.x format; no `config/features` entry, legacy `.import` resources | 4.3.0 | `export_presets.cfg` missing | 1 | `Unexpected "Identifier" in class body`; `Could not find base class "Particles2D"` | `BUILDER_VERSION_MISMATCH` | The source is a Godot 3 project and cannot be parsed by the pinned Godot 4.3 builder. |

The exit code for every project was produced by the provider's Docker invocation. The
reporting harness correctly converted the failed build status into `BUILD_FAILED`; it
did not turn a successful build into a failure.

## Evidence comparison

### Builder and provider

- The workflow successfully built `game2web/godot-builder:4.3.0`; the builder
  Dockerfile downloads the Godot 4.3 Web export templates and `build.sh` copies
  `web_*.zip` into the 4.3 template directory before invoking Godot.
- None of the five logs contains `No export template found` or an equivalent
  missing-template error.
- The provider always invokes the literal preset name `Web`.
- `GodotProvider.detect()` returns `compatible: true` for every archive containing
  `project.godot`; it does not validate the engine version, `export_presets.cfg`,
  or the presence of a Web preset.
- `examples/godot-demo` contains both a Godot 4 project and a valid Web preset
  named `Web`. Its renderer is `gl_compatibility`, matching the 4.x builder
  assumptions. The external projects do not share that complete input contract.

### Common cause versus independent causes

There is a common Game2Web validation gap: detection accepts a generic
`project.godot`, while the builder requires a Godot 4-compatible source and a
Web export preset named `Web`. This explains the immediate failures for
Turn-based RPG, Godot Runner, and RoboBlast.

The remaining failures are independent project/toolchain incompatibilities:

- Godot Runner and GDQuest use Godot 3-era APIs.
- The Platformer targets Godot 4.4 while the pinned builder is 4.3.0 and its
  clean archive did not provide the imported resource files referenced during
  import.
- RoboBlast has no Web preset and also has FBX conversion failures in the
  sandboxed builder.

Therefore the five failures are **not** one missing-template or one broken Docker
builder defect. They are a provider preflight gap combined with project-specific
version, export configuration, and asset/import incompatibilities.

## Classification

| Classification | Applies to | Evidence |
|---|---|---|
| `PROVIDER_BUG` | Common preflight behavior | `detect()` accepts only `project.godot`; the build path unconditionally selects `Web`. |
| `BUILDER_VERSION_MISMATCH` | Godot Runner, Platformer, GDQuest | Godot 3-era syntax, Godot 4.4 project versus 4.3 builder, and Godot 3-era classes/resources. |
| `EXPORT_CONFIGURATION` | Turn-based RPG, Godot Runner, RoboBlast | Missing `export_presets.cfg`, or no Web preset. |
| `ASSET/IMPORT_FAILURE` | Platformer, RoboBlast, GDQuest | Missing imported resources, FBX converter exit 127, and legacy `.import`/resource errors. |
| `BUILDER_BUG` | None proven | No missing-template error; the builder completed setup and reported source-specific errors. |
| `HARNESS_ERROR` | None proven | The Docker command, polling, failure capture, and `BUILD_FAILED` classification matched the observed exits. |

## Root cause summary

Common failure:

> The compatibility preflight is too permissive for the provider's fixed build
> contract: a `project.godot` file is sufficient to queue a Godot 4.3 Web build,
> even when the source has no Web export preset or is from another Godot major
> version.

Affected projects: all five reached the same provider build path; the observed
build errors then diverged by project.

Game2Web bug: **YES**, limited to compatibility preflight/diagnostics.  
Builder bug: **NO evidence** in this run.  
Project incompatibility: **YES**, for the version, export, and asset cases listed
above.  
Recommended fix: add a provider validation/preflight check for the detected Godot
major version and an actual Web export preset before queuing the build. Preserve
the current `network=none` and container restrictions. Do not modify upstream
projects or generate export presets automatically.

## M9.1 scope decision

No provider, builder image, or upstream repository was changed during the M9.1
diagnosis.

**Result: M9.1 ROOT CAUSE ANALYSIS COMPLETE**

## M9.2 implementation follow-up

The subsequent preflight implementation uses this run as its regression
baseline. It keeps this historical evidence unchanged and adds local fixtures
for Godot 3 syntax, builder version mismatch, missing Web presets, missing
resources, and the FBX2glTF limitation. The updated Compatibility Lab reports
the preflight classification and skips projects rejected before build. A new
runtime Compatibility Lab run validated the changes against the same external
repositories:

| Project | Previous result (run 37712046826) | Preflight result (run 37715094089) | Build started |
|---|---|---|---|
| Turn-based RPG | `BUILD_FAILED` | `REQUIRES_ADAPTATION` — Godot 4.0 has no configured matching builder; Web preset is missing | No |
| Godot Runner | `BUILD_FAILED` | `UNSUPPORTED` — Godot 3.x legacy API markers | No |
| Godot 2D Platformer | `BUILD_FAILED` | `REQUIRES_ADAPTATION` — requires Godot 4.4, but only 4.3 builder is configured | No |
| RoboBlast | `BUILD_FAILED` | `REQUIRES_ADAPTATION` — Godot 4.2 builder absent; non-Web preset, Forward renderer, and FBX conversion dependency | No |
| GDQuest A-RPG | `BUILD_FAILED` | `UNSUPPORTED` — Godot 3.x legacy API markers | No |

The new report recorded preflight times between 1 and 11 ms per project. All
five returned `NOT_RUN` for build, artifacts, and player; therefore the lab run
demonstrates that known incompatibilities no longer consume a worker, not that
these external projects are playable.

The normal CI run [37714277688](https://github.com/Milbornee/Test_Web/actions/runs/37714277688)
also passed static checks and the infrastructure runtime suite, including the
Godot and SDL build/player paths and the new API rejection E2E. Both runs used
commit `b83c9d4741e9d2f736e804b7e7e85e0a237e174d`.

**Result: M9.2 PRE-FLIGHT VALIDATED**  
The broader Compatibility Lab is not declared complete: this run correctly
classified all five external projects before build, so none produced external
artifacts or player sessions.
