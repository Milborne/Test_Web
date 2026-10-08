# Public beta architecture

The beta separates the application origin (`APP_ORIGIN`, normally `https://app.game2web.app`) from the player origin (`PLAYER_ORIGIN`, normally `https://play.game2web.app`). The application serves dashboard/API traffic and owns authentication cookies. The player serves only READY deployment artifacts.

The API persists private sources in object storage, queues a build with BullMQ, and the worker validates the project binding before running a non-root, network-disabled Docker builder. Artifacts are written to an immutable project/build prefix and exposed publicly only through a READY deployment.
