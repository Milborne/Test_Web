# Origins

`APP_ORIGIN` is the only allowed CORS origin for authenticated API requests. `PLAYER_ORIGIN` is public content and receives no session cookie because cookies are host-only; no `.game2web.app` domain cookie is used. Locally, the app origin is `http://localhost:3000` and the player/API origin is `http://localhost:4000`. Production should use separate HTTPS origins such as `https://app.game2web.app` and `https://play.game2web.app`.

The player response uses a narrow runtime CSP and immutable asset caching. The Godot runtime requires `wasm-unsafe-eval` and inline styles/scripts in published content; these exceptions are limited to the player response and are not enabled as an API-wide wildcard policy.
