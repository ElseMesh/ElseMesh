# ElseMesh experimental preview publisher

**[Open the experimental preview](https://lozknowles.github.io/ElseMesh-preview/)**

This repository publishes a static WebGPU test build from the exact
[`lozknowles/ElseMesh` draft PR #5](https://github.com/lozknowles/ElseMesh/pull/5)
commit pinned in [the Pages workflow](.github/workflows/deploy-preview.yml).
It contains a publisher recipe, not a second game source tree. The served
`preview-build.json` states the exact source commit and preview scope.

The preview lets a friend try the island while the source is reviewed. It
does **not** run an internet multiplayer server or qualify live cross-world
travel. The visible banner and separate browser save names distinguish it
from the [existing public build](https://lozknowles.github.io/ElseMesh/).

To contribute game changes, use the PR #5 source branch
`feature/network-federation-hardening` in the main repository. Fork it and
propose a pull request, or ask the maintainer for collaborator access if direct
pushes are needed. See the main repository's [README](https://github.com/lozknowles/ElseMesh/blob/feature/network-federation-hardening/README.md),
[changelog](https://github.com/lozknowles/ElseMesh/blob/feature/network-federation-hardening/CHANGELOG.md),
and [qualification status](https://github.com/lozknowles/ElseMesh/blob/feature/network-federation-hardening/docs/EXPERIMENTAL-PREVIEW.md).

## Update or roll back

Edit the single pinned source commit in `.github/workflows/deploy-preview.yml`
after source tests pass. A push to this publisher's `main` builds and deploys
that exact commit. To roll back, restore a previously verified commit and push
the workflow change. To retire this experimental link, disable Pages in this
repository's settings. None of these operations changes the existing
`lozknowles.github.io/ElseMesh/` site or draft PR #4.
