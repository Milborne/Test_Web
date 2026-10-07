# Authentication

Game2Web uses email/password authentication with `scrypt` password hashing and random salts. Passwords are never stored or returned. A random, hashed session token is persisted in PostgreSQL and sent as an HttpOnly, SameSite cookie with a seven-day expiry. The CSRF token is a separate non-HttpOnly cookie and must be echoed in `x-csrf-token` for mutating authenticated requests.

Registration and login are rate-limited. Password reset and OAuth are intentionally deferred until email delivery and provider configuration exist.
