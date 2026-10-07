# Multi-tenancy

The tenancy graph is `User -> Project -> ProjectFile, Build -> BuildLog/Artifact, Deployment`. `Project.userId` is explicit and indexed. Project creation assigns the current session user; project listing, build creation, and build inspection all scope by that owner.
