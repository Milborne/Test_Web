# Known risks

- The worker still needs Docker daemon access. This is a privileged host boundary, not a complete sandbox; use dedicated hosts and rootless/remote builder daemons before public beta.
- The local API has no authentication/authorization. It is suitable only for local validation and must not be exposed to untrusted users.
- Published HTML currently travels through the local API origin. A separate asset origin, CSP, and iframe sandbox are required before authenticated browser sessions are supported.
- Builder base images and export templates must be promoted through a digest-pinned, reviewed supply-chain process before production.
- Bind-mounted output disk usage is not cgroup-quota controlled on every Docker storage driver; use a quota-backed workspace volume for hostile workloads.
- Compose credentials are development defaults. Production must provide generated secrets and private service networking.
