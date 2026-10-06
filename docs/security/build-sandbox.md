# Build sandbox

Every build gets a unique temporary workspace and Docker container. The builder runs as UID/GID `1000:1000`, with `--network=none`, a read-only root filesystem, read-only source, separate output, a 512 MiB no-exec `/tmp`, dropped capabilities, `no-new-privileges`, CPU and memory limits, a PID limit, and a hard process timeout. Containers are removed with `--rm`; worker cleanup runs in `finally` after success or failure.

`BUILD_MAX_MINUTES`, `BUILD_MAX_MEMORY_MB`, `BUILD_MAX_CPUS`, `BUILD_MAX_PIDS`, `BUILD_MAX_DISK_MB`, `BUILD_MAX_UPLOAD_MB`, `BUILD_MAX_FILES`, and `BUILD_MAX_EXPANDED_SOURCE_MB` define the policy. Disk enforcement for bind-mounted output remains host-filesystem dependent; production should use a quota-backed dedicated worker volume.
