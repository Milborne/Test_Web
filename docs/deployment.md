# Deployment

For production, deploy web and API separately, run PostgreSQL/Redis/S3 with managed services, and run workers on isolated machines. Set the same provider image digests across workers. Put a reverse proxy/CDN in front of the web player and expose only published artifact prefixes. Do not expose source uploads through the public bucket.

Before enabling public builds, add persistent auth, upload scanning, signed object-storage URLs, rate limiting, audit logs, and a dedicated worker runtime policy.
