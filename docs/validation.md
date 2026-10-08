# Validation contract

The authoritative validation entry points are:

```bash
bash scripts/check-env.sh
bash scripts/validate-mvp.sh
```

CI uses Node `22.11.0`, Godot builders `4.3.0` and `4.4.0`, and Emscripten builder `3.1.74`. Docker and Docker Compose are supplied by the GitHub-hosted Ubuntu runner; the workflow prints their versions before execution. `.nvmrc` keeps the local Node version aligned with CI.

The harness does not use sleeps to infer readiness. Compose healthchecks gate PostgreSQL, Redis, and MinIO readiness, and the Godot step runs the pinned builder with:

- UID/GID `1000:1000`;
- `--network=none`;
- CPU and memory limits;
- read-only source mount;
- read-only container filesystem;
- temporary `/tmp`;
- no Docker socket.

The harness exits with `MVP END-TO-END VALIDATED` only after the upload, MinIO artifact persistence, deployment record, API/worker status propagation, and browser E2E player test all pass. Any earlier failure exits non-zero and reports `NOT VALIDATED`.
