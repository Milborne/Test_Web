# GitHub Pages manual preview

The manual Pages preview runs the pinned Godot 4.4 builder through the existing Compatibility Lab path:

```text
external source at pinned SHA -> Game2Web preflight -> API -> BullMQ -> worker -> Docker builder
  -> validated artifacts in private MinIO -> integrity-checked Pages site artifact
  -> GitHub Pages deployment -> separate real-browser runtime check
```

The `GitHubPagesPreviewDeploymentProvider` prepares the static site from the validated artifact set. GitHub Actions performs the actual Pages upload and deployment: publishing requires the short-lived `pages: write` and `id-token: write` job permissions and must not grant those capabilities to the application API. The existing local/private preview provider and production static provider are unchanged. Only files listed as validated build artifacts are exported. The exporter checks every downloaded size and SHA-256 checksum, rejects unsafe paths and source/log/environment files, and requires `index.html`, JavaScript, and WebAssembly.

## Enablement and use

Pages must use the GitHub Actions source:

```text
GitHub repository
-> Settings
-> Pages
-> Build and deployment
-> Source
-> GitHub Actions
```

The repository Pages site is configured for Actions. To create or replace the latest manual preview, run **Actions -> Game2Web GitHub Pages Preview -> Run workflow** on `main`. The deploy job consumes the uploaded Pages artifact with `needs: build`, has `contents: read`, `pages: write`, and `id-token: write`, and uses the `github-pages` environment. Action references are pinned to commit SHAs. The printed URL is the `page_url` output from `actions/deploy-pages`, not a constructed URL.

When that workflow completes successfully on `main`, `Game2Web GitHub Pages Preview Check` automatically runs in a separate runner. It downloads the recorded deployment URL and launches Playwright directly against GitHub Pages; it does not use localhost or a runner-local web server. A manual recheck can also be started with the same workflow by supplying the exact Pages URL.

The URL and workflow run are printed to the Actions summary and saved in the `github-pages-preview-url` artifact. Build logs are kept separately in `github-pages-preview-build-logs`; the Pages artifact itself contains only the game files and `.nojekyll`.

## Visibility, isolation, and limitations

GitHub Pages is public hosting. Anyone with the URL can load the game, and it is not an owner-authenticated or secret-link preview. Use this only when public access to the built game is acceptable. Pages is on `github.io`, separate from the Game2Web application origin; the game receives no Game2Web session or CSRF cookies. The browser test checks for leaked Game2Web cookies and same-site private API requests.

Pages does not provide application-controlled response headers for an artifact deployment. In particular, the Game2Web player's CSP, cache policy, and token authorization cannot be reproduced here. The separate origin limits access to application-origin cookies, but does not make untrusted game code safe to execute in the visitor's browser. Do not put secrets, source archives, build logs, or private project information in the Pages artifact.

There is one Pages site and one latest manual preview. A new deployment replaces the previous site. No automatic expiry or revocation is configured; the deployment remains available until another Pages deployment or an administrator disables Pages. This workflow does not publish a production `Deployment`, alter redistribution status, or add the game to a gallery.

GitHub Pages is not an alternative to the private, expiring M9.5 preview lifecycle. It is an explicitly public technical test path. The owner is responsible for ensuring the game artifacts may be made publicly accessible.
