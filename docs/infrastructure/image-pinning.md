# Builder image policy

Builder Dockerfiles use exact version tags: Godot `flashlight13/godot:4.3` and Emscripten `emscripten/emsdk:3.1.74`; runtime invocation uses the exact Emscripten builder tag and a configurable Godot builder reference. `npm run image-policy` rejects floating `latest` tags in builder Dockerfiles.

Digest promotion is intentionally an explicit release operation. The current local repository does not claim digest pinning until each digest has been resolved and verified against the registry; the policy output therefore reports version-tag compliance rather than falsely claiming immutable digests.
