# Sessions

Sessions are opaque random tokens stored only as SHA-256 hashes. The raw token is issued in an HttpOnly cookie, never localStorage. Logout deletes the session server-side and clears both cookies. Production sets `Secure`; local validation leaves it unset for HTTP localhost.
