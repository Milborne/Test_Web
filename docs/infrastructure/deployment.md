# Deployment

`LocalStaticDeploymentProvider` remains the default for local development. `PublicStaticDeploymentProvider` is selected with `DEPLOYMENT_PROVIDER=public` and derives public URLs from `PLAYER_ORIGIN`. Every deployment points to one build and one immutable artifact prefix; the player rejects any deployment whose build is not READY.
