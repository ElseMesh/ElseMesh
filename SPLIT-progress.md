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
| Registry-based, world-agnostic engine behavior and component installation | **50%** | `WorldBehaviorRegistry.js`, generic component envelopes, renderer-neutral traits, and registered installers exist. `App.installWorldComponents()` now selects an ElseMesh-owned backend adapter for `elsemesh.water-body/1`; the WebGL fallback also dispatches `water-body` and `island-ocean` through engine adapters. WebGL support readiness requires a registered adapter for water-surface traits, with tests proving unhandled surfaces remain unsupported. Tidewater's terrain, vegetation, reef, wildlife, fish prop, whale, village material, and boat installers still live in `worlds/tidewater/component-installers.js`. **Still incomplete:** other WebGL presentation in `src/fallback/WebGLFallback.js` and Tidewater-specific material handling in `WorldPackage.js` remain; the default app still loads Tidewater registrations. Acceptance requires migrating the remaining handlers and proving an independent world can load without Tidewater code. |
| World packages remain renderer-neutral; ElseMesh selects WebGPU or WebGL | **33%** | `elsemesh.water-body/1` uses engine-owned WebGPU and WebGL adapters selected by the active backend registry; the WebGL ocean component also uses an engine-owned adapter. Integration checks confirm both backends register adapters and that missing adapters are reported unsupported. However, `worlds/tidewater/webgl-behavior.js` still contains Tidewater WebGL dispatch/adapters, `component-installers.js` imports WebGPU engine classes, and other `WebGLFallback.js` component paths remain world-specific. Acceptance requires migrating the remaining handlers behind engine-owned registries and verifying the same world package behavior on both renderers. |
| Tidewater gameplay and content parity: WebGPU baseline, WebGL aligned | **75%** | Tidewater has deterministic pre-split WebGPU fishing and boat traces plus WebGPU/WebGL fishing and WebGL fish-stand/boat content checks under `worlds/tidewater/test/`. [`PROJECT-DIRECTION.md`](PROJECT-DIRECTION.md) records package integration/parity at 75%. Remaining: verify the complete gameplay/content path after the final separation edits, compare the split build with the pre-split WebGPU reference, inspect the world in the isolated browser display, and resolve any differences. WebGL appearance is not a visual baseline. |

## Current work and next gates

Earlier commits ElseMesh `69e8805` and Tidewater `4896050` moved WebGPU
component installers into Tidewater and dispatched them through the registry.
The current v3 cleanup removes obsolete local migration aliases in Blender and
`worldd`. The Hogwarts submodule is reported dirty and is outside this work;
preserve it without inspection beyond its pointer/status or staging.

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
