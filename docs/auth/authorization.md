# Authorization

Private API routes resolve the authenticated session first, then scope queries directly by `project.userId`. A resource ID is never treated as permission. Builds, logs and artifacts are reached through an owned project/build relationship; unknown or foreign resources return the same not-found shape where possible.

Public `/api/play/<slug>` serves only a READY deployment and never exposes source, logs, or project administration.
