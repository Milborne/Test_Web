# Godot provider compatibility

The Godot provider performs a static preflight at upload and again immediately
before a build is queued. The worker repeats the check against the persisted
source archive before launching the builder. Preflight reads project files only;
it does not run project scripts, plugins, binaries, or user commands.

## Engine and builder versions

The pinned builder matrix currently contains only Godot 4.3. A project that
declares a different Godot 4 minor version is classified as
`REQUIRES_ADAPTATION` until a matching builder is configured. Godot 3 projects
are `UNSUPPORTED`; Game2Web does not migrate project files. A missing version
declaration is reported as `SUPPORTED_WITH_WARNINGS` only when the other Web
requirements pass, because preflight cannot safely infer a version from absent
metadata.

The version-to-builder mapping is centralized in
`packages/providers/src/index.ts`. Additional pinned images can be added to that
matrix without changing the version-selection logic.

## Web export requirements

A project must contain exactly one runnable export preset whose platform is
`Web`. The preset name can be any name; the provider passes the inspected name
to the builder rather than assuming it is literally `Web`. Game2Web does not
generate or persistently edit `export_presets.cfg`. Missing or ambiguous
presets are `REQUIRES_ADAPTATION`. The Web export also requires Godot's
Compatibility renderer; Forward+ and Forward Mobile projects are rejected
before build.

## Resource and dependency checks

Preflight checks literal `res://` references in readable project text files,
enabled editor-plugin manifests, native extensions, and FBX assets. Resource
reference analysis is intentionally bounded and is not a complete Godot parser.
Missing referenced files require adaptation. Native extensions are not
supported by the current Web builder.

The builder performs a headless editor import inside its isolated, offline
container before export. This generates normal derived import data from source
assets without network access. If a source asset itself is absent, the import
cannot recreate it.

Godot 4.3 reports FBX conversion failures when its external `FBX2glTF`
converter cannot be executed. The pinned image does not install that converter,
and the builder runs with `network=none`; FBX inputs are therefore classified
as `REQUIRES_ADAPTATION`. Convert those source assets to glTF/GLB before upload.
Game2Web does not download converters or alter uploaded assets.

Enabled editor plugins must have their referenced `plugin.cfg` in the source.
Plugins and native extensions are never executed by preflight. Projects that
depend on custom/plugin code may still encounter a build-time failure after
passing the static checks.

## Result statuses

- `SUPPORTED`: the declared engine has a matching builder, and the project has
  one valid Web preset with no detected blocker.
- `SUPPORTED_WITH_WARNINGS`: the project meets known requirements, but its
  engine version could not be confirmed.
- `REQUIRES_ADAPTATION`: a remediable input requirement is missing or unsupported
  by the configured builder, such as a Web preset, resource, renderer, native
  extension, or FBX conversion dependency.
- `UNSUPPORTED`: the engine major version is outside the provider's supported
  range, or the project structure is ambiguous.

Only `SUPPORTED` and `SUPPORTED_WITH_WARNINGS` projects are queued. A
`BUILD_FAILED` result is reserved for a project that passed preflight and then
failed in the actual builder. Preflight status, builder version, selected Web
preset, missing files, warnings, errors, requirements, and inspection duration
are returned by the API and included in Compatibility Lab reports.
