# Security fixtures

The security suite uses these fixture names when exercising archive validation:

- `path-traversal.zip`
- `absolute-path.zip`
- `symlink-escape.zip`
- `too-many-files.zip`
- `oversized-file.zip`
- `invalid-project.zip`
- `infinite-build-fixture/`

Fixtures are generated in test workspaces rather than committed with host-destructive payloads. They must only contain inert files and must never target the host filesystem.
