# Repository split roadmap

## Current priority: separate the engine and Tidewater content

ElseMesh is the reusable engine repository. Tidewater is a separate, content-only
repository at `https://github.com/ElseMesh/tidewater`, included as the
`worlds/tidewater` submodule so the engine can import and serve its package.
Tidewater does not need to build or run on its own.

Burning Horizons is a different world-content repository at
`https://github.com/ElseMesh/burning-horizons`. It is independent from Tidewater
and is not included in ElseMesh. It may be checked out separately when needed
for two-world portal integration work.

Keep authored world data and world-specific assets in their content repositories.
Keep reusable renderers, simulation, validation, packaging, server code, and
authoring tools in ElseMesh. Tidewater interaction declarations use validated,
versioned data, while ElseMesh implements their authoritative runtime behavior.
Preserve existing gameplay during migration; a general sandboxed scripting
runtime is later work.

## Deferred work

- Make the imported Tidewater package the demo world and verify that its current
  appearance and supported gameplay survive the move.
- Add authoritative multiplayer state scopes for shared, player, group, and
  explicitly persistent data. Keep state isolated by world instance and carry
  platform identity across portal travel.
- Start the graphical world editor in ElseMesh after Tidewater import and
  multiplayer acceptance. The editor should edit Tidewater source through the
  same validation and packaging path.
- Continue the existing early-entry, streaming, portal, and network work after
  the repository split is verified.

## Acceptance

- A clean ElseMesh checkout initializes the Tidewater submodule and builds with
  the package available to the engine.
- Tidewater package import, content hashes, and deployment checkout are verified.
- Burning Horizons remains independently cloneable and can be supplied as a
  separate fixture for two-world portal checks without becoming part of
  ElseMesh or Tidewater.
- Commit each repository's changes in its own history and push only after the
  destination repositories contain the referenced commits.
