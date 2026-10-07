# Compatibility Lab

The lab tests external Godot repositories without vendoring or modifying them. It clones each repository into a temporary workspace, records the exact commit, uploads a Git archive through the existing API, and runs the normal Godot worker, artifact, deployment, and player path.

Run it only against an isolated development stack:

```bash
COMPATIBILITY_LAB=true npm run compatibility:lab
```

The build remains subject to the normal non-root, no-network, resource-limited builder sandbox. Temporary source, projects, builds, and deployment data are removed when the command exits. Reports remain in `tests/compatibility/reports/`; external source is never committed.
