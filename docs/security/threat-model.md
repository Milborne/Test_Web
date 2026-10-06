# Game2Web threat model

User projects are untrusted input. The trust boundary is:

```text
Project upload -> API -> private source storage -> BullMQ -> worker -> Docker builder -> validated artifacts -> published deployment
```

The API validates and persists an archive but never executes it. The worker is the privileged build orchestrator and is the only component that talks to the Docker daemon. Builders receive only a read-only source mount, a separate output mount, no Docker socket, no host network, and no application secrets. A builder compromise can still attack the worker/daemon boundary; production must therefore place workers on dedicated hosts and use rootless Docker or a dedicated builder daemon.

The published game is untrusted browser content and must not share an authenticated origin. The current local player is development-only; a private beta needs a separate asset origin and iframe sandbox before handling authenticated users.
