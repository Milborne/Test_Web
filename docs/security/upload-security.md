# Upload security

Uploads are bounded before queueing by compressed byte size and file count. Paths are normalized to `/` and reject absolute paths, `..` path components, NUL bytes, symlinks, excessive expansion, and extreme compression ratios. The worker repeats archive checks after downloading from private storage, so queue metadata cannot weaken validation.

Source archives are stored below `sources/<project-id>/` and are never served by the player. A future authenticated API must authorize every project and build query; the current local MVP API is not an internet-facing authorization boundary.
