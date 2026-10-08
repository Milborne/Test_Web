# Builder image policy

Builder Dockerfiles pin both exact version tags and source image digests: Godot `flashlight13/godot:4.3` and Emscripten `emscripten/emsdk:3.1.74`. The Godot registry describes the local derived image as locally built (`digest: null`) and records its verified base-image digest separately; do not claim a digest for a derived image until the image itself has been published and inspected. Runtime selects from that registry and does not accept an arbitrary image override. `npm run image-policy` rejects base builder references without a 64-character SHA-256 digest.

Digest promotion is intentionally an explicit release operation. The current local repository does not claim digest pinning until each digest has been resolved and verified against the registry; the policy output therefore reports version-tag compliance rather than falsely claiming immutable digests.
