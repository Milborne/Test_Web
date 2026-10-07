# Quotas and admission control

The API performs disk admission using `statfs` before queueing a build and rejects requests below `BUILD_MIN_FREE_DISK_MB`. It also limits active builds per user with `MAX_CONCURRENT_BUILDS_PER_USER` and the worker limits total execution with `MAX_CONCURRENT_BUILDS`. Source expansion and artifact size are independently bounded.

`statfs` is monitored admission control, not a universal hard quota for bind mounts. Beta workers should use a dedicated quota-backed volume and alert on remaining capacity.
