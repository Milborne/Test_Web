# Providers

Providers implement `BuildProvider` in `packages/providers/src/index.ts`:

- `detect(files)` returns deterministic evidence and warnings.
- `validate(files)` performs compatibility checks before a build.
- `build(context)` invokes a pinned builder image.
- `collectArtifacts(outputDirectory)` returns generated files.

Add a provider by implementing the interface, registering it in `providers`, adding a pinned Docker builder, and adding detection tests. Providers must fail explicitly when the required toolchain or output entry point is unavailable. Unity, Unreal, and DOS are registered as unavailable so the UI never implies unsupported conversion.
