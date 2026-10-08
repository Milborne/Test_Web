# Beta environment

Use `.env.production.example` as the reviewable contract for beta configuration. Supply secrets through a secret manager, use HTTPS origins, private PostgreSQL/Redis/S3-compatible services, `DEPLOYMENT_PROVIDER=public`, dedicated worker hosts, and a quota-backed workspace volume. Do not reuse development databases, MinIO credentials, or cookies.
