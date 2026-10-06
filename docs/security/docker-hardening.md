# Docker hardening

The worker is the only process allowed to invoke Docker. No builder receives `/var/run/docker.sock`, privileged mode, host networking, devices, host PID/IPC namespaces, or application environment variables. Builder commands are argument arrays passed to `execFile`, not shell strings.

The Docker daemon remains a privileged trust boundary. For beta deployment, run workers on dedicated hosts, prefer rootless Docker where the selected builder images support it, pin builder images by digest, and monitor/limit daemon access. The local Compose file binds infrastructure ports to loopback and is not a production topology.
