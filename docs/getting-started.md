# Getting started

1. Install Node.js 20+, Docker, and Docker Compose.
2. Run `npm install`.
3. Copy `.env.example` to `.env`.
4. Start local dependencies with `docker compose -f infra/docker-compose.yml up -d`.
5. Build builder images:

```bash
docker build -t game2web/emscripten-builder:latest builders/emscripten
docker build -t game2web/godot-builder:4.3 builders/godot
```

6. Start the API and web app with `npm run dev`.

The API accepts multipart source archives and persists them to MinIO before a build can be queued. The worker queue is real: build requests carry a storage key, the worker downloads into a temporary isolated workspace, invokes the selected Docker builder, validates output, uploads artifacts, and creates an immutable deployment. It refuses to publish an output without a non-empty `index.html`.

## Full validation

With Docker Compose running, execute `bash scripts/validate-mvp.sh`. The script installs dependencies, validates the Prisma schema, builds the pinned Godot image, starts API/worker/web, uploads `examples/godot-demo` to MinIO through the API, waits for the BullMQ worker, checks persisted artifacts and deployment, and runs Playwright against `/play/<slug>`. It also verifies an invalid archive is rejected. Any failed stage exits non-zero and reports `NOT VALIDATED`.
