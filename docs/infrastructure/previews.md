# Preview deployments

A preview is an owner-authorized technical deployment of a READY `PREVIEW` build. It is separate from production deployments and does not change the project's redistribution status. Production builds still require `REDISTRIBUTION_CLEARED`; a preview is not permission to publish or redistribute third-party content.

For an explicitly public GitHub Pages test that does not use the private preview lifecycle, see [GitHub Pages manual preview](github-pages-preview.md). Pages is public and has no token authorization, CSP control, or automatic expiry.

## Lifecycle

1. The project owner queues a `PREVIEW` build. The worker validates and stores build artifacts under `private/<projectId>/<buildId>/`.
2. The owner creates a preview only after that build reaches `READY` and has validated artifacts.
3. The API copies each artifact to `previews/<projectId>/<buildId>/<previewId>/`, verifies its SHA-256 checksum, then marks the preview `READY` and starts its TTL. Incomplete previews remain inaccessible; abandoned `CREATING` rows use an additional 24-hour cleanup grace period.
4. A cryptographically random 256-bit token is returned as a link. Only its SHA-256 hash is stored in PostgreSQL; API request URL logging is redacted so player asset requests do not expose the token in service logs. The owner can recover a lost link from the dashboard; link recovery rotates the token and invalidates the previous URL. Anyone holding the current link can access the game until expiry or revocation.
5. The web preview page embeds the existing player route. The player serves only preview artifacts; source archives, build logs, project settings, and authenticated API routes remain private.
6. Expired or revoked previews are marked `DELETING`, then their objects and metadata are removed. Object deletion is idempotent. Failures leave retryable metadata and are logged for the worker's next cleanup pass.

`PREVIEW_TTL_HOURS` defaults to 24 and accepts 1–168 hours. `PREVIEW_TTL_SECONDS` may be set to 1–604800 seconds for short-lived integration tests; when set, it takes precedence.

## Storage and durable links

The application uses the configured S3-compatible `S3_ENDPOINT` and `S3_BUCKET`; preview objects always use the isolated `previews/` key prefix. Objects are not made public by this application: the player API authorizes requests against READY, unexpired, unrevoked preview metadata and reads the object through the storage abstraction. The S3 endpoint and bucket must be durable and reachable by both the build/API environment and the externally deployed player API.

`PREVIEW_PERSISTENT=true` is not by itself proof of persistence. The API only reports `persistent: true` when `PREVIEW_STORAGE_DURABLE=true` is also explicitly set and the preview app origin, player origin, and S3 endpoint use HTTPS. The operator must verify that the database, storage, web preview route, and player API all survive the CI runner. Do not point a CI run at production database or storage.

The Compatibility Lab's default dispatch uses ephemeral local PostgreSQL, Redis, MinIO, API, and web services and must report `persistent: false`. Its optional persistent dispatch requires dedicated staging GitHub Actions secrets:

- `PREVIEW_DATABASE_URL`
- `PREVIEW_S3_ENDPOINT`
- `PREVIEW_S3_BUCKET`
- `PREVIEW_S3_ACCESS_KEY`
- `PREVIEW_S3_SECRET_KEY`
- `PREVIEW_APP_ORIGIN`
- `PREVIEW_PLAYER_ORIGIN`

The staging web application and player API must already be deployed with a schema/code version compatible with this repository and share the configured staging database and bucket. The persistent workflow validates the preview before teardown and then opens the same external URL in Playwright after local Compose has been removed. If the required secrets or external services are unavailable, persistent validation remains pending; a localhost URL must never be reported as persistent.

## Origins and security

`PREVIEW_APP_ORIGIN` is the HTTPS origin hosting `/preview/<token>`. `PLAYER_ORIGIN` is the distinct origin hosting `/api/preview/<token>/...`. The player's CSP permits framing by the configured app and preview app origins. Auth cookies remain host-only to the authenticated application origin; the public player receives no application session cookie and CORS continues to allow credentials only from `APP_ORIGIN`.

Creation and revocation require an authenticated project owner and CSRF validation. Anonymous visitors may play a preview using its secret URL, but cannot create, revoke, or administer it. Preview responses are `private, no-store`; expired, revoked, incomplete, or non-READY builds return 404.

## Production distinction and licensing

Preview builds never create a `Deployment` row and are not listed as published production games. `Project.redistributionStatus` remains unchanged. Production build creation is denied until the owner explicitly attests redistribution clearance; keep projects with unconfirmed code, asset, or music licenses in preview-only testing and do not promote their artifacts to production.

## Dashboard

The owner can create a preview from a project card. The dashboard waits for the real build to complete, requests the owner-authorized preview, and shows its URL, expiry, open action, and copy-link action. A non-persistent link is clearly labeled as temporary.
