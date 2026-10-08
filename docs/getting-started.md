# Getting started

1. Install Node.js 20+, Docker, and Docker Compose.
2. Run `npm install`.
3. Copy `.env.example` to `.env`.
4. Start local dependencies with `docker compose -f infra/docker-compose.yml up -d`.
5. Build builder images:

```bash
docker build -t game2web/emscripten-builder:3.1.74 builders/emscripten
docker build -f builders/godot/Dockerfile -t game2web/godot-builder:4.3.0 .
docker build -f builders/godot-4.4/Dockerfile -t game2web/godot-builder:4.4.0 .
```

6. Start the API and web app with `npm run dev`.

The API accepts multipart source archives and persists them to MinIO before a build can be queued. The worker queue is real: build requests carry a storage key, the worker downloads into a temporary isolated workspace, invokes the selected Docker builder, validates output, uploads artifacts, and creates an immutable deployment. Production builds require an explicit redistribution-clearance attestation. Projects awaiting license review can use `mode: "PREVIEW"`; owner-authorized previews receive an unguessable expiring token and use the isolated `previews/` storage namespace.

Previews are not considered manually available after a workflow unless the deployment environment configures externally reachable HTTPS `PREVIEW_APP_ORIGIN`, `PLAYER_ORIGIN`, and `S3_ENDPOINT`, sets `PREVIEW_STORAGE_DURABLE=true`, and explicitly enables `PREVIEW_PERSISTENT=true`. The GitHub-hosted Compatibility Lab defaults to local ephemeral services and reports `persistent: false`; those URLs stop working when the job ends. The optional persistent Compatibility Lab dispatch requires the dedicated `PREVIEW_*` staging secrets described in [preview infrastructure](infrastructure/previews.md), and validates the URL again after local Compose teardown. Preview lifetime defaults to 24 hours (`PREVIEW_TTL_HOURS`, maximum 168); `PREVIEW_TTL_SECONDS` allows bounded short lifetimes for tests. Expired/revoked objects are deleted by the worker with retryable metadata state.

## Full validation

With Docker Compose running, execute `bash scripts/validate-mvp.sh`. The script installs dependencies, validates the Prisma schema, builds the pinned Godot image, starts API/worker/web, uploads `examples/godot-demo` to MinIO through the API, waits for the BullMQ worker, checks persisted artifacts and deployment, and runs Playwright against `/play/<slug>`. It also verifies an invalid archive is rejected. Any failed stage exits non-zero and reports `NOT VALIDATED`.
