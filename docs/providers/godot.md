# Godot provider compatibility

The Godot provider performs a static preflight at upload and again immediately
before a build is queued. The worker repeats the check against the persisted
source archive before launching the builder. Preflight reads project files only;
it does not run project scripts, plugins, binaries, or user commands.

## Engine and builder versions

The builder registry contains separate Godot 4.3 and 4.4 builders. Each base
image is pinned by an observed registry digest; the 4.4 image also verifies the
official Godot export-template archive against the upstream SHA-512 release
manifest during image construction. The registry selects an exact builder
match first and permits only explicitly listed project-version compatibility;
it does not silently fall back between 4.3 and 4.4. The 4.3 compatibility
allow-list includes Godot 4.0 for the M9.3 external project validation. Other
unlisted Godot 4 versions and projects without a detectable version are
`REQUIRES_BUILDER`. Godot 3 projects are `UNSUPPORTED`; Game2Web does not
migrate project files. The derived builder images are constructed in CI from
these pinned inputs; they are not published to a public registry by this
workflow.

The version-to-builder mapping is centralized in
`packages/providers/src/index.ts`. Additional pinned images can be added to that
matrix without changing the version-selection logic.

## Web export requirements

A project with a preset must contain exactly one runnable export preset whose
platform is `Web`. The preset name can be any name; the provider passes the
inspected name to the builder rather than assuming it is literally `Web`. If
no preset exists and static checks identify a 2D project without other blockers,
the builder generates a controlled temporary preset in its writable copy.
It never edits the stored source archive. For similarly safe 2D projects, a
Forward renderer setting can be overridden with Compatibility only in that
temporary copy. Projects with 3D indicators are not switched automatically.
Ambiguous/invalid presets and unsafe adaptations require project changes.

## Resource and dependency checks

Preflight checks quoted and escaped `res://` references in readable project text files,
enabled editor-plugin manifests, native extensions, and FBX assets. Resource
reference analysis preserves complete paths with spaces and punctuation and
remains intentionally bounded; it is not a complete Godot parser. Missing
referenced files require adaptation. Native extensions are not
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

- `SUPPORTED`: an explicitly compatible builder is configured and the project
  has one valid Web preset with no detected blocker.
- `SUPPORTED_WITH_WARNINGS`: known requirements pass, with bounded temporary
  adaptations or other non-blocking warnings.
- `REQUIRES_BUILDER`: the project's engine version has no explicit compatible
  builder mapping, or its version cannot be determined.
- `REQUIRES_ADAPTATION`: a project requirement needs changes, such as missing
  resources, an unsafe renderer change, native extensions, or FBX conversion.
- `UNSUPPORTED`: the engine major version is outside the provider's supported
  range, or the project structure is ambiguous.

Only `SUPPORTED` and `SUPPORTED_WITH_WARNINGS` projects are queued. A
`BUILD_FAILED` result is reserved for a project that passed preflight and then
failed in the actual builder. Preflight status, builder version/image/digests,
temporary adaptations, selected Web preset, missing files, warnings, errors,
requirements, and inspection duration are returned by the API and included in
Compatibility Lab reports.
