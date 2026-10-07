# Production checklist

- Configure DNS and TLS for app and player origins.
- Put API, database, Redis, and private storage on private networks.
- Pin all production images by verified digest.
- Run workers on dedicated hosts with rootless/remote Docker where supported.
- Use quota-backed workspace storage and monitor admission capacity.
- Configure backups, alerting, incident response, and deployment rollback.
- Add a public CDN/static provider before exposing beta traffic.

Passing CI does not replace these operational controls.
