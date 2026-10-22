# Split Tidewater content from ElseMesh

## Summary

Move the authored island into a data-focused Tidewater repository, imported into ElseMesh as a Git submodule. Make that imported package the demo world. ElseMesh keeps the reusable engine and owns multiplayer authority; Tidewater describes its world and interactions in formats the engine validates and runs.

The LOZ-derived cave remains independent in its own content repository and submodule, preserving the two-world portal fixture. Begin the graphical editor inside ElseMesh after Tidewater imports and passes the multiplayer integration checks.

## Implementation Changes

- Create `ElseMesh/tidewater` and `ElseMesh/loz-underneath`; mount them at `worlds/tidewater` and `worlds/loz-underneath`. Move each world’s authored map, objects, assets, credits, source descriptors, and exported package into its repository. Tidewater does not need to be independently compilable or runnable.
- Keep reusable renderers, simulation, validation, packaging, and server code in ElseMesh. Tidewater declares supported interactions through validated, versioned behavior data; engine-owned handlers implement them. Reserve a sandboxed-script extension for behaviors the engine cannot yet express, but defer a general scripting runtime.
- Replace the hard-coded procedural island as the demo-world source with the imported Tidewater package. Preserve existing gameplay and appearance by expressing its current supported interactions and rules in package data and running them through ElseMesh’s authoritative runtime.
- Add world-instance state interfaces for shared, player, group, and explicitly persistent data. ElseMesh validates and synchronizes state per instance; Tidewater defines which interactions and state scopes it uses. Keep instances isolated even when they use the same package, and carry platform identity across portal travel without carrying world-instance state.
- Start the graphical editor in ElseMesh only after the package import and multiplayer acceptance gates pass. It edits Tidewater source and assets through the same validation and packaging path.

## Test Plan

- From a clean checkout with submodules initialized, build ElseMesh, load Tidewater as the demo world, and verify that its package assets and interaction declarations are imported and served. Regenerate the package and check deterministic hashes.
- Run existing JavaScript and Go suites, plus focused tests for unsupported behavior rejection, malformed content, server-side authority, and state scope enforcement.
- Use multiple clients to verify shared Tidewater interactions, player/group/persistent state boundaries, rejection of client-forged state, reconnect behavior, portal identity continuity, and isolation between two instances of the same world.
- Run the two-world portal integration using the separate LOZ fixture and compare the Tidewater demo’s appearance and supported gameplay with the current island.

## Assumptions

- The repository URLs will be `https://github.com/ElseMesh/tidewater` and `https://github.com/ElseMesh/loz-underneath`; the LOZ slug follows its existing directory name.
- Tidewater declares behavior and state rules as data. Engine code implements current supported behaviors; a general sandboxed scripting system comes later.
- Tidewater’s existing player progression is persistent only where its package explicitly declares it, and uses platform identity rather than browser-local storage.
