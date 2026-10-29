# ElseMesh world-split progress

Last assessed: 2026-10-29. Percentages are rough completion estimates for the
active engine/world-separation and Tidewater parity goal. They measure the
acceptance gates met, not code volume or test coverage. Reassess a percentage
only when implementation or verification evidence changes; update this file
in the same change that moves it.

There is no overall average: a high score on repository layout cannot offset an
unfinished runtime boundary or parity gate.

## Progress by requirement

| Requirement | Estimate | Evidence and remaining acceptance gate |
| --- | ---: | --- |
| Keep authored Tidewater and Hogwarts world data in their own repositories | **100%** | Both are mounted as submodules and documented in [`docs/world-repository-layout.md`](docs/world-repository-layout.md). Repository separation is recorded complete in [`GOAL-done.md`](GOAL-done.md). This measures authored-data ownership only; engine-side runtime handlers still need extraction. |
| ElseMesh protocol and world identity namespace v3, with no old-ID compatibility | **100%** | Signed manifests require `elsemesh.world/3`; source requires `elsemesh.world-source/3`; client/server/Blender reject old world IDs and manifest/source protocols. Obsolete Blender metadata aliases and the daemon's Tidewater-named local profile/ZeroTier auto-migration paths have been removed. Focused identity/Blender checks, `go test ./...`, the full client suite, and the external build passed. Historical negative tests mention old forms only to prove rejection. |
| Owner-signed JavaScript world extensions run in dedicated browser Workers; no Wasm implementation | **90%** | `src/network/WorldJavaScriptExtension.js` and its Worker enforce message bounds, startup/run limits, and worker teardown; server manifest validation binds extension assets to signed `javascript/1` assets. No Wasm runtime is implemented. Remaining: re-run extension lifecycle and signed-manifest integration checks against the final tree and ensure the world package integration uses this generic host path. |
| Registry-based, world-agnostic engine behavior and component installation | **55%** | `WorldBehaviorRegistry.js`, generic component envelopes, renderer-neutral traits, and registered installers exist. `App.installWorldComponents()` selects ElseMesh-owned backend adapters for `elsemesh.water-body/1` and `elsemesh.static-fish-props/1`; the WebGL fallback dispatches those plus `island-ocean` through the same adapter registry. Tidewater now declares fish-props without supplying a renderer installer. WebGL support readiness requires registered adapters for water-surface traits, with tests proving unhandled surfaces remain unsupported. Tidewater's terrain, vegetation, reef, wildlife, whale, village material, and boat installers still live in `worlds/tidewater/component-installers.js`. **Still incomplete:** other WebGL presentation in `src/fallback/WebGLFallback.js` and Tidewater-specific material handling in `WorldPackage.js` remain; the default app still loads Tidewater registrations. Acceptance requires migrating the remaining handlers and proving an independent world can load without Tidewater code. |
| World packages remain renderer-neutral; ElseMesh selects WebGPU or WebGL | **39%** | `elsemesh.water-body/1` and `elsemesh.static-fish-props/1` use engine-owned WebGPU and WebGL adapters selected by the active backend registry; the WebGL ocean component also uses an engine-owned adapter. Hosted WebGL sea-level detection consumes the registry's generic `waterSurface` trait rather than enumerating water component IDs. The village vertex-data attribute is now `_ELSEMESH_VDATA`, removing the Tidewater-specific `_TW_` tag from the engine loader; the Tidewater package exporter regenerates the content-addressed assets with the new attribute. Integration checks confirm both fish-props adapters register and the WebGL adapter installs from a backend-neutral component declaration. However, `worlds/tidewater/webgl-behavior.js` still contains Tidewater WebGL dispatch/adapters, `component-installers.js` still supplies backend-dependent installers for other components, and other `WebGLFallback.js` component paths remain world-specific. Acceptance requires migrating the remaining handlers behind engine-owned registries and verifying the same world package behavior on both renderers. |
| Tidewater gameplay and content parity: WebGPU baseline, WebGL aligned | **80%** | Tidewater has deterministic pre-split WebGPU fishing and boat traces plus WebGPU/WebGL fishing and WebGL fish-stand/boat content checks under `worlds/tidewater/test/`. The full client suite passes after the hosted-water fixes. An isolated WebGPU capture shows the hosted shoreline foam and surf restored against the pre-split reference; WebGL runtime checks confirm the packaged fish stand/content is present and the moored boat remains stable. Remaining: compare more reference views, exercise fish-stand interaction and underway boat behavior in the live split build, and resolve any visual differences. WebGL appearance is not a visual baseline. |

## Current work and next gates

Earlier commits ElseMesh `69e8805` and Tidewater `4896050` moved WebGPU
component installers into Tidewater and dispatched them through the registry.
The current v3 cleanup removes obsolete local migration aliases in Blender and
`worldd`. The Hogwarts submodule is reported dirty and is outside this work;
preserve it without inspection beyond its pointer/status or staging.

### Fish-prop ownership boundary

Fish-prop placements, species presentation, and model-specific geometry belong
to Tidewater. ElseMesh owns renderer selection, GPU resource creation, drawing,
culling, and LOD. A world Worker may produce or transform renderer-neutral
typed-array data once and transfer its buffers to the client; the render loop
must not depend on per-frame Worker messages. The current `FishProps` class
mixes fish-specific geometry with ElseMesh rendering APIs, and the WebGPU and
WebGL component adapters still interpret Tidewater's fish-prop component in
the engine. This is a known separation gap, not a completed migration. Any
refactor must preserve the existing batched draw, culling, shadow, and LOD
behavior while keeping world code independent of the selected renderer.

Next, migrate the remaining world-supplied component installer callbacks and
backend-specific behavior hooks behind engine-owned registries, then remove
Tidewater-specific WebGL component dispatch and material handling from
`WorldPackage.js`. Keep renderer choice in ElseMesh and expose backend-neutral
contracts to worlds. Then sync to the external build tree and run
isolated-browser parity checks. Update the estimates above only when a gate is
newly supported or a finding changes them.

## Verification record

- 2026-10-29: focused streaming, registry, v3 identity, signed Worker, and
  content-submodule checks passed in the external build tree.
- 2026-10-29: `node tools/run-tests.mjs` and `npm run build` both passed in the
  external build tree. These verify the current suite/build, not visual parity
  in the browser; component installer extraction and isolated-browser review
  remain open.
- 2026-10-29: the verified source changes and this ledger were committed and
  pushed; Hogwarts was not staged.
- 2026-10-29: WebGPU component installers now use registry callbacks from the
  Tidewater submodule. Focused registry/streaming checks, the full test suite,
  and external production build passed. WebGL and `WorldPackage.js` dispatch
  remain unextracted.
- 2026-10-29: the WebGPU installer extraction and progress update were pushed
  as ElseMesh `69e8805` and Tidewater `4896050`; Hogwarts was not staged.
- 2026-10-29: removed obsolete Blender metadata aliases and Tidewater-named
  `worldd` data/ZeroTier profile migration paths. Blender identity checks,
  `go test ./...`, the full client suite, and external build passed.
- 2026-10-29: WebGL component readiness and vehicle resolution now use registry
  traits, with a non-Tidewater fixture proving classification is type-agnostic.
  Focused checks, the full client suite, and external production build passed.
  The suite now inherits Go's configured module cache unless `GOMODCACHE` is
  explicitly set; the old temporary cache contained an incomplete toolchain.
  Visual parity and backend-neutral package integration remain open.
- 2026-10-29: generic water-body installation now selects an ElseMesh-owned
  adapter by the active WebGPU/WebGL backend; the WebGL ocean component also
  dispatches through the registry. Live module registration, missing-adapter
  behavior, the full client suite, and external production build passed.
  Tidewater-specific installer callbacks and WebGL behavior hooks remain; no
  browser visual-parity review was performed.
- 2026-10-29: static fish-prop rendering now selects engine-owned WebGPU and
  WebGL adapters, and Tidewater no longer supplies a renderer installer for
  that component. Focused registry/adapter checks, the full client suite, and
  the external production build passed. This does not complete Tidewater
  behavior/material extraction or visual parity review.
- 2026-10-29: hosted WebGPU water now uses the hosted terrain's shoreline
  simulation for foam, breakers, spray and underwater effects. An isolated
  browser capture restored the beach surf/foam seen in the pre-split WebGPU
  reference; the hosted breaker mesh uses 577 package shoreline stations.
  WebGL runtime checks confirmed the packaged fish stand is installed and the
  moored boat remains finite and upright on both backends. The full client
  suite passed after the hosted-player activation fix. Exact multi-view
  appearance, live fish interaction and underway boat comparison remain open.
- 2026-10-29: hosted WebGL sea-level detection now classifies water components
  through the registered `waterSurface` trait instead of a hardcoded list of
  component IDs. Focused registry and water-surface checks passed; backend-
  specific Tidewater gameplay/presentation hooks remain to be extracted.
- 2026-10-29: renamed the village vertex-data GLB attribute from `_TW_VDATA`
  to `_ELSEMESH_VDATA` across the engine loader, Tidewater exporter, checks,
  and generated content-addressed package. Tidewater world-export and
  village-material tests plus the engine profile test passed.
- 2026-10-29: after syncing the regenerated package into the external build
  tree and removing only its two obsolete content-addressed asset files, the
  full client suite and external production build passed. The cpto dry run
  showed only the requested changed files; no submodule was pruned.
