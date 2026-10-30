# ElseMesh world-split progress

Last assessed: 2026-10-30. Percentages are rough completion estimates for the
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
| Owner-signed JavaScript world extensions run in dedicated browser Workers; no Wasm implementation | **95%** | `src/network/WorldJavaScriptExtension.js` and its Worker enforce message bounds, startup/run limits, and worker teardown; server manifest validation binds extension assets to signed `javascript/1` assets. On 2026-10-30, isolated Chromium exercised the real module Worker through `createWorldBehaviorExtensions`, including world-data initialization and stateful sequential calls; source-to-manifest, signed asset, and server validation checks also passed. No Wasm runtime is implemented. Remaining: exercise activation through a complete signed world-package launch. |
| Registry-based, world-agnostic engine behavior and component installation | **55%** | `WorldBehaviorRegistry.js`, generic component envelopes, renderer-neutral traits, and registered installers exist. `App.installWorldComponents()` selects backend adapters from the generic registry. Tidewater registers its fish-prop WebGPU and WebGL installers from its own component module; ElseMesh chooses the active backend. Tidewater's fish-prop and village material asset decoders register through `WorldComponentAssetCodecRegistry.js`. World package material adapters now register by component type; `WorldPackage.js` no longer imports or names Tidewater's village material profile, decoder, or shader builder. Reusable `BoatController` no longer imports Tidewater's berth and requires the caller to pass a world-authored initial position. Tidewater's vendor locations, lanterns, and fishing habitat areas come from registered behavior data; its fishing game and WebGL adapter share one habitat calculation and no longer read engine `WorldLayout.js`. `src/main.js` consumes a generic virtual default-world package binding; an alternate package module build compiled 283 modules versus 358 for the Tidewater default, but this is build-time evidence only. **Newly confirmed coupling:** normal `App.init()` constructs `IslandWorldState` even for a hosted `worldLink`, initializing Tidewater terrain/collider state before generic world-package loading. `WebGLFallback` also imports `IslandDefinition` and uses it during renderer setup. Thus the alternate-package build does not prove a Tidewater-independent runtime. Tidewater's WebGPU/WebGL fish-prop checks only verify construction/resource cleanup, not pixels or FPS. Tidewater's terrain, vegetation, reef, wildlife, whale, village material, and boat installers still live in `worlds/tidewater/component-installers.js`. **Still incomplete:** remove unconditional island initialization and world constants from generic launch/render paths, migrate Tidewater-specific presentation in `src/fallback/WebGLFallback.js`/`WebGLVillageMaterials.js` and renderer dependencies inside Tidewater's package material adapter, then launch an independent world on both backends. |
| World packages remain renderer-neutral; ElseMesh selects WebGPU or WebGL | **52%** | `elsemesh.water-body/1` and `elsemesh.static-model-instance-set/1` now have engine-owned adapters selected by the backend registry. The static model format validates signed GLB references, and both renderers consume the same frustum/LOD/fade/shadow selection and transform data. The shared planner supports projected-radius or scale-normalized distance LOD, authored transition widths, world-space draw limits, and draw-range fades, with shadow selection independent. A generated GLB fixture builds and updates both backends and renders 128 non-background pixels in isolated WebGPU and WebGL checks; WebGL compiles its color and shadow programs with no GL errors. This proves the generic component path, not real Tidewater output or FPS. Tidewater has not exported its fish-stand models to this format; fish-prop adapters and other backend-specific installers remain. Hosted WebGL presentation paths still contain world-specific behavior. Acceptance requires migrating real Tidewater content and checking matched output and gameplay in both renderers. |
| Tidewater gameplay and content parity: WebGPU baseline, WebGL aligned | **78%** | Tidewater has deterministic pre-split WebGPU fishing and boat traces plus WebGPU/WebGL fishing and fish-stand/boat checks in its own repository. The production-style isolated comparison is pinned to pre-split ElseMesh `23c30bf62aae2aefd0f2bcdd3edc650cf960ce3e` and uses packaged Tidewater terrain. On 13 shore/dock samples, WebGL query height MAE is 0.0094 m (max 0.0504 m), normal-component MAE 0.0045, and terrain-floor MAE 1.8e-7 m. The corrected CPU shore profile matches direct WebGPU displacement at 0.000013 m mean / 0.000056 m max; its Eulerian shore hook differs from WebGPU shore-only query by 0.0003 m mean / 0.0008 m max. A controlled 18-second moving-boat trace (production FFT and packaged shore, fixed 1/60 s input lead, no interactive wake/collisions) now ends 0.103 m apart, with max speed delta 0.012 m/s. Same-position water height along that trace differs by 0.0065 m mean / 0.0150 m max; FFT-only error is 0.0059 m mean / 0.0145 m max. The isolated correctness harness substitutes synchronous pixel readback and is not production async-readback or FPS evidence. Earlier direct WebGPU renders against the same pre-split commit were pixel-identical for four ocean views; six static island/pier views differed by at most 0.00543 RGB MAE, but neither is a live cross-renderer comparison. **Remaining:** compare production WebGPU and WebGL visuals/gameplay directly; rerun the live steering trace, verify async query and interactive wake/collision behavior, compare boarding and fishing interaction sequences, and measure hardware FPS.

## Architecture assessment

The intended boundary is **not complete yet**. ElseMesh is partly
content-agnostic: world IDs, component and asset registries, and much of the
world-package loader are generic. However, engine runtime paths still contain
content assumptions: `src/world/fish/FishProps.js` implements fish-specific
geometry/material presentation, `src/fallback/WebGLFallback.js` owns village
material and other world presentation paths, and the Tidewater component
installer imports engine rendering classes directly. Moving data into a world
repository has therefore not yet made the engine independent of that world's
content.

World packages are also **not yet renderer-agnostic**. ElseMesh chooses the
active WebGPU/WebGL component adapter, but Tidewater's `webgl-behavior.js`
constructs WebGL-only fish-stand, chandlery, and game presentation, and
`register-behavior.js` exposes WebGL-named hooks. The target is for a world to
provide backend-neutral content, placements, material inputs, and behavior data
while ElseMesh owns renderer selection and both backend implementations. The
static model instance-set format now has a signed asset resolver, shared
visibility/LOD runtime, and engine-owned WebGPU and WebGL adapters. A generated
GLB fixture checks installation, transformed geometry, instance updates,
separate shadow batches, and rendered pixels on both backends. Tidewater's
fish-stand export and fish-specific renderer have not migrated to this generic
component, so these generic renders do not prove real-world parity.

The configurable default-package build binding is only a partial boundary:
`App.init()` still creates Tidewater's `IslandWorldState` for normal launches,
including hosted-world URLs, and the WebGL renderer still reads
`IslandDefinition`. A different package can compile without Tidewater's package
registrations, but a Tidewater-independent runtime has not been demonstrated.

## Current work and next gates

Earlier commits ElseMesh `69e8805` and Tidewater `4896050` moved WebGPU
component installers into Tidewater and dispatched them through the registry.
The current v3 cleanup removes obsolete local migration aliases in Blender and
`worldd`. The Hogwarts submodule is reported dirty and is outside this work;
preserve it without inspection beyond its pointer/status or staging.

### Fish-prop ownership boundary

Fish-prop placements, species presentation, and model-specific geometry belong
to Tidewater. ElseMesh owns renderer selection, GPU resource creation, drawing,
culling, and LOD. The generic WebGPU multi-kind instance batch has been moved
from `src/world/reef/ReefBatch.js` to the public engine render surface as
`MultiKindInstanceBatch`; Reef, swimming fish, and props now consume that engine
primitive. This extracts batching infrastructure only: fish-specific geometry,
materials, and component adapters are still in ElseMesh. The fish-prop record codec now lives in Tidewater and
registers as the `fish-props-placement/1` asset decoder; ElseMesh adapters invoke
that generic decoder registry. The adapters still know the fish-prop component
and construct its renderer. The current signed behavior Worker only accepts
self-contained modules, JSON messages/results up to 16 KiB, and calls up to
50 ms; it cannot currently transfer prepared mesh buffers. Do not route geometry
or per-frame render updates through that API. The current `FishProps` class mixes
fish anatomy generation and shader semantics with ElseMesh rendering APIs. The
WebGL adapter bakes one full-detail mesh, without the
WebGPU path's per-item culling and LOD. This remains an engine/world gap and a
renderer-parity gap. The migration needs world-owned model/material/placement
assets plus a generic renderer-neutral instance-set contract whose WebGPU and
WebGL implementations share asset references, transforms, and LOD policy.
Preserve batching, shadows, distance LOD, and appearance against the original
WebGPU baseline. Any Worker data-preparation path must be a one-time transferable
handoff; frame rendering stays in ElseMesh.

Moving fish-specific source or data into the Tidewater repository does not by
itself change runtime cost. The engine must retain batched GPU submission,
visibility culling, shadow handling, and distance LOD behind a backend-neutral
rendering API. The current WebGL fish-prop adapter's single draw call is not
proof of equivalent efficiency: it expands every placement into full-detail
CPU-side geometry and has no per-placement culling or LOD. Do not move that
implementation into Tidewater unchanged and call the performance goal met.
The class also serves Tidewater's live fish stand, catch display, portraits, and
built-in world props; it is not only a hosted static-content installer. It
directly depends on ElseMesh `ReefBatch` and fish shader internals. Extracting
the file wholesale would therefore relocate backend rendering code rather
than establish a world-owned fish presentation on a generic engine renderer.
The call sites need to be split between Tidewater's fish-specific data and
placement rules and an engine-owned reusable batch-rendering interface. A
generic static model instance-set format and WebGPU/WebGL batch adapters now
exist, but Tidewater's hosted fish-prop component still uses its older
fish-specific renderers.
`FishGeometry.js` is also used by the engine's swimming `Fish.js`, and
`FishMaterial.js` supplies both swimming-fish and prop shaders, so moving either
file wholesale would pull Tidewater model code and renderer implementation
together. Treat those as separate extraction points. The generic static model
instance-set format and both engine adapters now provide shared instancing,
visibility, LOD fades, and shadow selection. Tidewater still needs to export
content-addressed per-LOD model data, material inputs, placements, and bounds
through that format, then remove its fish-specific hosted renderers. The live
stand, catch-display, and portrait call sites need a dynamic form of the same
engine rendering interface, with game decisions staying in Tidewater behavior
and instance updates staying local to the browser renderer.
The per-species stand-height scale and tail/gill anchors are now data in
Tidewater's registered fish-presentation profile; the engine's `FishProps`
static placement helpers were removed. WebGPU/WebGL rendering code remains in
ElseMesh, and the WebGL mesh expansion/LOD gap is unchanged.

Village material profile names, roles, and map metadata now register in the
generic `WorldMaterialProfileRegistry`. Tidewater owns the packaged map schema
and binary codec and registers it through the generic component-asset decoder;
WebGL hosted loading consumes the decoded asset through that registry. A
generic package-material adapter registry dispatches profile preparation and
GLB material resolution to Tidewater's provider; `WorldPackage.js` no longer
imports Tidewater's decoder or shader builder. The provider still imports
engine renderer APIs, and the WebGL presentation path remains profile-specific;
those are still separation work.

Next, migrate the remaining world-supplied component installer callbacks and
backend-specific behavior hooks behind engine-owned registries, then move
Tidewater's WebGL presentation and its renderer-dependent package material
adapter behind backend-neutral contracts. Keep renderer choice in ElseMesh and
expose backend-neutral contracts to worlds. Migrate Tidewater static fish
content to the generic instance-set contract; do not move `FishProps.js`
wholesale. Then run matched isolated-browser checks for visuals, shadows, and
gameplay. Update the estimates above only when a gate is newly supported or a
finding changes them.

## Verification record

- 2026-10-29: focused streaming, registry, v3 identity, signed Worker, and
  content-submodule checks passed in the external build tree.
- 2026-10-29: `node tools/run-tests.mjs` and `npm run build` both passed in the
  external build tree. These verify the current suite/build, not visual parity
  in the browser; component installer extraction and isolated-browser review
  remain open.
- 2026-10-29: the verified source changes and this ledger were committed and
  pushed; Hogwarts was not staged.
- 2026-10-30: added the generic static-model asset resolver and engine-owned
  WebGPU/WebGL installers. Both consume signed GLB references, share camera
  conversion and the visibility/LOD/shadow planner, and build instanced main
  and shadow-LOD batches from the same transformed primitives. Isolated
  generated-GLB render checks now prove 128 visible pixels on WebGPU and WebGL;
  the WebGL color and shadow programs compile with no GL errors. This check found
  and fixed the fragment shader injection dropping Three.js's common chunk. The
  full client suite and external production build passed. Tidewater export and
  matched WebGPU/WebGL visuals and gameplay remain open.
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
- 2026-10-29: moved Tidewater's village material profile and allowed role list
  into the Tidewater repository and made ElseMesh package/WebGL code resolve
  roles through a generic registry. This removes the engine's direct import of
  Tidewater's profile parser; village material decoding and renderer creation
  are still directly coupled and remain open.
- 2026-10-29: moved village package material preparation and GLB material
  resolution behind a generic world-package material adapter registry. The
  Tidewater package module now supplies its own adapter; `WorldPackage.js`
  handles registered profiles and lifetimes without a Tidewater component ID
  or direct Tidewater renderer imports. Focused profile/package checks,
  Tidewater world export, and the full client suite passed. The Tidewater
  adapter still imports engine material/rendering APIs, so renderer-neutral
  world presentation remains unfinished.
- 2026-10-29: moved the village map catalog and binary encoder/decoder into
  Tidewater. Tidewater registers the asset decoder generically, and the WebGL
  fallback consumes decoded map metadata instead of importing a Tidewater
  asset module. The focused material checks, Tidewater world export, WebGL
  content checks, and full client suite passed. No production build or visual
  browser comparison was run; the existing build tree was left untouched due
  to 412 tracked modifications. Live renderer behavior still needs
  cross-backend visual verification.
- 2026-10-29: removed the built-in Tidewater dock default from `BoatController`.
  WebGPU and WebGL built-in callers now pass the berth explicitly; hosted boats
  already use their signed berth. The built-in coordinates still live in the
  engine's `IslandDefinition.js`, so the authored-data move remains open. The
  origin, pre-split controller trace, WebGL idle, and WebGL underway checks
  passed. The full client suite now runs the pre-split boat water-query trace;
  live visual cross-backend checks remain open.
- 2026-10-29: moved Joe's and Marta's lantern placement out of `App.js` into
  Tidewater's registered fishing behavior. Their positions and yaw come from
  that world's behavior data, and activation installs each world once. The
  coordinates are no longer read from engine `IslandDefinition.js` for this
  feature.
- 2026-10-29: removed the Tidewater fish-stand and chandlery fallback
  placements from their game and WebGL modules. Both now require the signed
  fishing behavior to provide those locations, and the registry rejects a
  fishing world that omits either one. Tests source built-in placement from
  Tidewater's world data rather than the engine's island defaults. The focused
  fish-stand, chandlery, behavior-validation checks, and full client suite
  passed; no production build or visual parity capture was run.
- 2026-10-30: moved fishing habitat areas (pier and reef) into Tidewater's
  registered behavior data. WebGPU and WebGL now share the same habitat
  distance calculation, and Tidewater gameplay/minimap code no longer imports
  engine `WorldLayout.js`. Behavior validation, manifest round-trip, focused
  cross-adapter habitat checks, and the full client suite passed. Visual
  parity remains unverified.
- 2026-10-29: after syncing the regenerated package into the external build
  tree and removing only its two obsolete content-addressed asset files, the
  full client suite and external production build passed. The cpto dry run
  showed only the requested changed files; no submodule was pruned.
- 2026-10-29: moved the default world-package dependency out of `App.js` and
  `WebGLFallback.js`; the entry point now injects it, and the hosted-player
  test explicitly imports Tidewater registrations for its boat fixture. The
  full client suite and external production build passed. This creates a
  package seam but does not complete separation: `main.js` still assembles the
  built-in Tidewater world, and `App.js` still owns built-in island systems.
- 2026-10-29: moved Tidewater fish stand-height and hook-anchor data out of
  engine `FishProps` helpers and into the registered Tidewater presentation
  profile. Placement tables are data-only, and checks compare their derived
  values to the original geometry formula. Tidewater fish-presentation and
  deterministic world-export checks, the village render, the full client
  suite (including WebGPU/WebGL and pre-split gameplay traces), and the
  external production build passed. Fish geometry/material ownership and the
  WebGL per-item culling/LOD gap remain.
- 2026-10-29: moved the fish-prop placement codec into the Tidewater repository
  and added a generic engine component-asset decoder registry. Both backend
  adapters now request decoded records through the registry. The focused codec,
  registry, adapter, and manifest checks, full client suite (including
  WebGPU/WebGL and pre-split gameplay traces), and external production build
  passed. Renderer extraction and visual parity remain open.
- 2026-10-30: a matched live WebGPU review found hosted terrain had no shore
  field: Tidewater passed `null` to `TerrainGPU`, leaving the 1×1 no-shore
  placeholder active. Terrain package protocol 2 now includes the precomputed
  four-channel field generated from Tidewater-authored `swellDirection`; the
  hosted installer gives it to the generic terrain renderer. The isolated
  browser loaded the 512² field and built a 128² shore-direction texture, with
  all 577 breaker stations active. The beach capture again shows the turquoise
  shallows and breaking foam from the pre-split WebGPU reference. The production
  build and the client suite passed except the repository-layout test that
  reads Hogwarts files, which were intentionally not copied into this isolated
  build. The Tidewater export, terrain decoding, fishing, boat, and WebGL
  content/gameplay checks all passed; remaining visual views and live gameplay
  interactions remain open.
- 2026-10-29: moved the reusable multi-kind indirect instance batch from the
  reef world module into `src/engine/render/MultiKindInstanceBatch.js`, exported
  it on the WebGPU engine surface, and updated Reef, swimming fish, and fish
  props to consume the engine primitive. Syntax/import checks, the WebGL fish
  prop adapter check, and a headless reef render passed. This extracts batching
  infrastructure only; Tidewater model/material ownership, WebGL fish-prop
  culling and LOD, and visual parity remain open. The dirty external build tree
  was left untouched.
- 2026-10-29: a real headless Chromium run loaded a self-contained world module
  through `createWorldJavaScriptExtensionRuntime`, executed it in the dedicated
  module Worker, and received the expected result over the Worker message
  protocol. The browser used an isolated profile and process group, both
  cleaned up after the check. This verifies real browser Worker execution, not
  the full signed Tidewater package lifecycle; package integration and broader
  separation remain open.
- 2026-10-29: moved the Tidewater fish-prop WebGPU/WebGL component installers
  and WebGL presentation adapter into `worlds/tidewater/renderers/`; the world
  now registers both through ElseMesh's backend registry, which still selects
  the active renderer. Moved and renamed the Tidewater-specific WebGL fish-prop
  mesh-construction check to `worlds/tidewater/test/webgl-fish-props-adapter-build.mjs`;
  it does not create a GPU context or verify rendered output. This removes fish-prop registration and adapter
  implementation files from engine startup paths, while fish geometry/material
  ownership and backend-neutral rendering remain open. The full client suite
  passed, including WebGPU/WebGL fishing traces and frame-by-frame pre-split
  WebGPU fishing and boat parity checks.
- 2026-10-30: ran fresh isolated Chromium WebGL and WebGPU sessions with the
  same direct board/helm setup, initialized water queries, and 12 seconds of
  full-ahead followed by 6 seconds of left steering. Both boats stayed upright,
  but ended about 23 m apart (WebGL x/z 118/145; WebGPU 97/136). Source review
  confirms the production query paths are different: GPU FFT/shore/wake versus
  a five-sine WebGL CPU surface plus Tidewater shore offset. This is a verified
  gameplay parity gap, so the estimate moved from 83% to 75%; the query and
  initial-state traces still need alignment and comparison to pre-split WebGPU.
- 2026-10-30: made the standalone headless WebGPU water-query check wait for
  asynchronous readback and assert valid, finite, varying FFT results; it had
  previously printed `valid false` and exited successfully. The check now
  passes with a 0.871 m height range. Compared production WebGPU and WebGL
  query samples at the same simulation time at five open-water points; their
  heights differed by 0.30–1.04 m before shore or wake terms. This reinforces
  the production parity gap, so the estimate moved from 75% to 65%. The
  pre-split boat trace, synthetic query sensitivity, fishing renderer trace,
  and WebGL underway stability checks pass; they do not close this gap.
- 2026-10-30: added a shared JavaScript ocean-spectrum parameter/coefficient
  generator while leaving WebGPU spectrum generation on its existing GPU path.
  A headless GPU comparison checks all 262,144 modes against WebGPU storage
  buffers; coefficient and wavenumber errors remain within the asserted bounds.
  This establishes shared spectral inputs for the WebGL backend, but no WebGL
  runtime consumes them yet, so the gameplay parity estimate remains unchanged.
- 2026-10-30: pinned the pre-refactor default spectrum uniforms and a custom
  wave-profile/seed fixture independently of the shared helper. The coefficient
  comparison and external production build pass. The next required parity slice
  is a WebGL GPU FFT that produces the shared displacement field; CPU sparse
  spectral evaluation is too expensive for production use.
- 2026-10-30: added a WebGL GPU FFT prototype and a browser comparison page using
  a separately generated headless WebGPU displacement baseline. On Chromium
  SwiftShader, all four 256x256 cascades passed the configured field tolerance
  at simulation time 4.25 s (786,432 displacement channels, 0.006 m mean and
  0.133 m maximum absolute error). The extra inverse-FFT normalization was
  removed after this comparison exposed it. This is a shader correctness check,
  not hardware performance or gameplay parity; WebGLWaterQuery does not consume
  the generated field yet, so the gameplay estimate remains 65%.
- 2026-10-30: WebGLWaterQuery now consumes the shared-parameter GPU FFT and
  mirrors production WebGPU terrain depth, shallow cascade attenuation, the
  Eulerian solve, finite-difference normals, and async readback snapshots.
  An isolated Chromium/WebGL comparison against a headless Dawn production
  WaterQuery reference passed eight points spanning deep and shallow water at
  4.25 s: height MAE 0.0262 m, maximum 0.0767 m, normal-component MAE 0.00517,
  and exact floor values. This synthetic check excludes Tidewater shore/wake
  composition; the earlier live boat trace used the old query and must be
  repeated. The gameplay estimate moved from 65% to 70%; visual parity, live
  steering traces, shoreline/wake matching, and FPS remain unverified.
- 2026-10-30: external `npm run build` and the full client `npm test` suite pass
  after the production query change. Tidewater's renderer-free rod/game/boat
  tests now use a Tidewater-owned synthetic query fixture; the actual GPU query
  is covered by the isolated browser parity check. Hogwarts remains dirty and
  was not inspected, staged, or changed.
- 2026-10-30: tested direct same-browser WebGPU/WebGL query comparison under
  SwiftShader. Chromium exposes a WebGPU adapter, but its four storage textures
  per compute stage are below ElseMesh's required five for the ocean FFT. The
  browser check now uses a direct WebGPU query only when full backend limits are
  met; otherwise it compares against the passing headless Dawn reference.
- 2026-10-30: compared headless WebGPU renders against the exact pre-split
  ElseMesh commit `23c30bf`. The unchanged `test/ocean-full.mjs` test produced
  four 2560x1267 images with identical SHA-256 hashes, zero renderer errors, and
  the same four pipelines on both revisions. The old `test/world-all.mjs` and
  current Tidewater-owned counterpart rendered six matching static views with
  identical triangle counts; RGB MAE ranged from 0 to 0.00543 and at most
  0.0195% of pixels differed by more than 2 levels. Optional scanned debris was
  excluded because its absolute model URLs cannot load in either Node harness.
  This raises the parity estimate from 73% to 75%; production Tidewater water,
  live WebGL, moving boat, wake, and hardware FPS gates remain open.

- 2026-10-30: matched the Tidewater WebGL shore hook to the pre-split
  WebGPU shoreline. The JS hash now follows f32 shader arithmetic, and the
  CPU profile uses the crest-depth interpolation from `shoreBreakDepth` for
  the wave profile. The 13-point direct shore error fell to 0.000013 m mean
  / 0.000056 m max. The isolated 18-second packaged-terrain boat trace fell
  from 0.555 m endpoint drift to 0.103 m, with 0.012 m/s maximum speed
  delta. Added regression bounds for shore, water-query, and boat deltas; the
  complete isolated Chromium parity run passed. This updates gameplay
  parity from 75% to 78%; live visuals, async readback, wake/collision,
  boarding, and hardware FPS remain open.
- 2026-10-30: clarified the generic static-model instance-set schema to use
  exactly one projected-radius threshold per LOD transition, and added the
  engine-owned renderer-neutral planner for sphere frustum culling, shared
  10% LOD fade weights, and shadow-distance selection. Contract and planner
  checks plus the full client suite passed. This does not change the boundary
  estimates: package installation and WebGPU/WebGL draw adapters still do not
  consume the planner, and no Tidewater export or fish-stand visual comparison
  has been completed.
- 2026-10-30: the generic static-model WebGPU and WebGL adapters now both
  consume the shared planner, including scale-normalized distance LOD and
  draw-range fades. Focused contract/adapter checks, the production build, and
  isolated browser renders passed on both backends. This is generic fixture
  evidence only; Tidewater fish content still uses its custom renderer, so the
  renderer-neutral boundary estimate remains 52%.
- 2026-10-30: removed the direct built-in-world import from `src/main.js` and
  added a configurable Vite package binding (`ELSEMESH_DEFAULT_WORLD_MODULE`).
  The Tidewater default and a separate temporary package module both compile;
  the latter omits Tidewater's world registrations from the built module graph.
  Runtime launch of an independent world is still unverified, so the behavior
  separation estimate remains 64%.
- 2026-10-30: source review of `App.init()` and `WebGLFallback` found that
  hosted launches still initialize `IslandWorldState`, and the WebGL renderer
  still imports `IslandDefinition`. The alternate-package build therefore
  proves package binding only, not a Tidewater-independent runtime. Corrected
  the behavior-separation estimate from 64% to 55%; the next boundary task is
  removing those unconditional Tidewater runtime dependencies.
