# Storage isolation

Source and published artifacts use different prefixes. Published artifacts are namespaced by immutable project and build IDs:

```text
sources/<project-id>/source.zip
published/<project-id>/<build-id>/<artifact>
```

The worker writes only the deployment prefix returned for the current project/build. API artifact lookup requires the deployment build and verifies the stored key has that prefix. The player never resolves source keys.
