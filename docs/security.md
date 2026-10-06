# Build security boundary

Uploaded source is untrusted. The worker must:

- execute only in an ephemeral container;
- use a non-root UID;
- set CPU, memory, timeout, and upload limits from environment configuration;
- use a read-only source mount and a separate output mount;
- disable network access with `--network=none`;
- never mount the host Docker socket;
- never use `--privileged`;
- reject path traversal and excessive file counts before storage;
- publish only a build that contains a validated `index.html`.

The API process must never compile uploaded source itself. Production deployments should run the worker on a dedicated host or node pool with restrictive container runtime policies.
