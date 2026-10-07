# Storage

Source objects remain private under `sources/<project-id>/source.zip`. Published objects use `published/<project-id>/<build-id>/` and are resolved through the deployment record, never through a client-selected object key. A public storage/CDN adapter can be introduced behind the existing storage and deployment interfaces; local beta validation continues to use MinIO.
