# Compatibility baselines

Store only metadata here, never upstream source archives. A baseline records the repository commit, Game2Web commit, toolchain, and deterministic result. The lab can compare a later report against these records to expose a `SUPPORTED` to `BUILD_FAILED` regression.

Example:

```yaml
project: turn-based-rpg
commit: <upstream commit>
result: SUPPORTED
engine: godot
toolchain: Godot 4.3.0
game2web_commit: <Game2Web commit>
```
