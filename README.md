# Game2Web

Game2Web turns compatible game projects into browser-playable builds through deterministic, isolated build pipelines. It does **not** use AI and does not claim support for arbitrary executables.

## MVP status

The repository now contains the first executable slice:

- Next.js dashboard and public player shell.
- TypeScript API with deterministic project detection and explicit unsupported-provider responses.
- Shared provider contracts for `emscripten-sdl` and `godot`.
- Real Docker builder commands for both supported providers (the host API never executes uploaded source directly).
- Prisma schema for PostgreSQL persistence.
- BullMQ/Redis and S3-compatible storage integration seams.
- Docker Compose development topology.

The development API persists projects and source archives through PostgreSQL and MinIO. A build is only marked ready after a worker reports a successful toolchain execution and the artifacts have been validated and persisted; there are no simulated successful builds.

**Official status:** `IMPLEMENTATION COMPLETE; RUNTIME VALIDATION PENDING`. The repository includes a GitHub Actions validation harness for the full `PROJECT -> BUILD -> DEPLOY -> PLAY` pass. This status must not change to validated until CI records a complete successful run.

## Milestone 1 validation

The reproducible fixture is `examples/godot-demo`. Its `project.godot` is detected by the `godot` provider and its Web export is configured in `export_presets.cfg`.

The full validation requires a machine with Node.js/npm and Docker. Run:

```bash
node --version
npm --version
docker --version
docker compose version
npm install
npm run typecheck
npm run build
docker compose -f infra/docker-compose.yml up -d
docker build -t game2web/godot-builder:4.3 builders/godot
```

The development API accepts a multipart `archive` upload at `POST /api/projects`, persists the source ZIP in the private MinIO bucket, and records its storage key, checksum, original filename, and file metadata in PostgreSQL. `POST /api/projects/:id/builds` queues only persisted sources; the worker creates a deployment after artifacts pass validation.

The local validation harness is:

```bash
bash scripts/check-env.sh
bash scripts/validate-mvp.sh
```

It fails explicitly with `NOT VALIDATED` if any storage, deployment, worker, builder, or browser E2E stage fails. CI preserves the report and logs as workflow artifacts.

## Run locally

```bash
npm install
cp .env.example .env
npm run dev
```

To run dependencies:

```bash
docker compose -f infra/docker-compose.yml up postgres redis minio
```

The web app runs at `http://localhost:3000`, and the API at `http://localhost:4000`.

## Supported providers

| Provider | Detection | Build | Notes |
| --- | --- | --- | --- |
| `emscripten-sdl` | `CMakeLists.txt` or `game2web.yml` override | Available in `builders/emscripten` | Requires an SDL-compatible C/C++ project and `emcmake` |
| `godot` | `project.godot` | Available in `builders/godot` | Requires a Godot project configured for Web export |
| Unity / Unreal / DOS | Explicitly reported as unavailable | Not available | No fake conversion path is exposed |

See `docs/` for provider authoring, security boundaries, deployment, and troubleshooting.

## End-to-End Validation

The authoritative validation workflow is `.github/workflows/ci.yml`. It runs on GitHub-hosted Linux with Node, Docker, Docker Compose, PostgreSQL, Redis, MinIO, the pinned Godot builder, the real API/worker queue, and Playwright. It is triggered on pushes, pull requests, and `workflow_dispatch`.

The workflow preserves API, worker, Compose, build, and Playwright logs as GitHub Actions artifacts when the runtime job finishes. Run the same local entry points with:

```bash
bash scripts/check-env.sh
bash scripts/validate-mvp.sh
```

This repository currently has no `package-lock.json`, so CI uses `npm install` rather than falsely using `npm ci`. The official status remains `IMPLEMENTATION COMPLETE; RUNTIME VALIDATION PENDING` until a complete GitHub Actions run reports `MVP END-TO-END VALIDATED`.