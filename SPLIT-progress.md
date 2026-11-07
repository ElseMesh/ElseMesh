# ElseMesh world-split progress

Last assessed: 2026-11-07. Percentages are rough completion estimates for the
active engine/world-separation and Tidewater parity goal. They measure the
acceptance gates met, not code volume or test coverage. Reassess a percentage
only when implementation or verification evidence changes; update this file
in the same change that moves it.

There is no overall average: a high score on repository layout cannot offset an
unfinished runtime boundary or parity gate.

## Progress by requirement

| Requirement | Estimate | Evidence and remaining acceptance gate |
| --- | ---: | --- |
| Avatar and vehicle portal acceptance, including destination moderation | **60%** | Signed `avatarPolicy.allowedProfiles` and `vehiclePolicy.allowedCombinations` now gate portal views, crossings, and owner presence admission. Presence protocol `/3` carries stable avatar-profile and vehicle-type IDs; the server verifies the profile matches the appearance, then enforces allowlists, boat compatibility, speed, and combined complexity. The full client suite, all Go suites, and external production build pass. **Remaining:** registry-backed catalogs for arbitrary avatars and vehicles, profile-specific complexity contracts, actual avatar substitution when a destination denies the current profile, and authoritative vehicle simulation. The current runtime exposes two stock profiles and one bundled boat. See [world network design](docs/world-network-design.md#desired-avatar-and-vehicle-admission-policy). |
| Keep authored Tidewater and Hogwarts world data in their own repositories | **100%** | Both are mounted as submodules and documented in [`docs/world-repository-layout.md`](docs/world-repository-layout.md). Repository separation is recorded complete in [`GOAL-done.md`](GOAL-done.md). This measures authored-data ownership only; engine-side runtime handlers still need extraction. |
| ElseMesh protocol and world identity namespace v3, with no old-ID compatibility | **100%** | Signed manifests require `elsemesh.world/3`; source requires `elsemesh.world-source/3`; client/server/Blender reject old world IDs and manifest/source protocols. Obsolete Blender metadata aliases and the daemon's Tidewater-named local profile/ZeroTier auto-migration paths have been removed. Focused identity/Blender checks, `go test ./...`, the full client suite, and the external build passed. Historical negative tests mention old forms only to prove rejection. |
| Owner-signed JavaScript world extensions run in dedicated browser Workers; no Wasm implementation | **94%** | `src/network/WorldJavaScriptExtension.js` and its Worker enforce message bounds, bounded startup/run limits, and worker teardown; the startup deadline now defaults to 5 seconds (10-second maximum) to tolerate cold browser startup. Server validation binds modules to signed `javascript/1` assets. Tidewater's fishing behavior calls its signed module for browser gameplay. Isolated Chromium verifies both an owner-signed in-memory package and a live `worldd` path: the browser fetches the signed module over the gateway, calls `App.activateHostedWorld()`, receives the subscribed activation event result from the real Worker, and calls `App.deactivateHostedWorld()` to dispose it. Tidewater's own live browser test signs the authored world experience, fetches the exact SHA-256 fishing module through the gateway, and drives both the WebGPU `Game.update()` path and WebGL adapter through cast input, bite, fight-to-catch, inventory, and sale using separate dedicated Workers. The generic manifest schema now accepts and validates the renderer-neutral sky/cloud profile used by Tidewater source. A hosted Tidewater WebGPU launch completed cold startup with no Worker or browser-console errors after the larger deadline. Both live tests use OS-assigned ports. Tidewater now rebinds a retained gameplay runtime to each activation-scoped Worker, clears transient bite/fight state on departure, and drops boat-step responses from the departed Worker generation. Tidewater runtime and behavior-hook checks cover re-entry, and the live signed-module WebGPU/WebGL gameplay test plus the App departure lifecycle test pass after this change. Event subscriptions are validated by client, source schema, and `worldd`. No world-behavior Wasm runtime is implemented. **Remaining:** repeat vendor interaction at authored coordinates in a full rendered world; finish renderer parity checks separately. |
| Registry-based, world-agnostic engine behavior and component installation | **83%** | Generic behavior/component registries and backend adapters are established. Tidewater owns its component registrations, fishing behavior, wildlife runtime, both WebGL and WebGPU vegetation renderers, WebGL reef renderer, village-material adapter, WebGPU/WebGL fish-prop adapters, and now its procedural terrain generator plus authored ridge, sea-stack, and footpath data. The built-in package provides layout and runtime state through presentation factories; App no longer imports a world-specific state or terrain generator. Tidewater's renderer-neutral CPU terrain feeds the engine's generic terrain render path. Tidewater supplies both its fish-school species behavior and ordered population/zone profile through world registries; ElseMesh retains the generic simulation, placement algorithm, and renderer. The seeded 63-group population snapshot matches exactly, Tidewater terrain/vegetation/reef/player checks pass, the full client suite passes, and the external production build succeeds. **Remaining:** terrain/reef/ocean presentation, whale, and several installers remain engine-owned; static fish content has not moved to the generic static-model LOD package; simulation modes and other Tidewater behavior data remain in engine modules; independent-world runtime and renderer parity are not fully proven. The latest hosted Tidewater WebGPU probe used software-backed Chromium at about 12 FPS and does not establish matched visuals or hardware performance. |
| World packages remain renderer-neutral; ElseMesh selects WebGPU or WebGL | **54%** | `elsemesh.water-body/1` and `elsemesh.static-model-instance-set/1` now have engine-owned adapters selected by the backend registry. The static model format validates signed GLB references, and both renderers consume the same frustum/LOD/fade/shadow selection and transform data. The shared planner supports projected-radius or scale-normalized distance LOD, authored transition widths, world-space draw limits, and draw-range fades, with shadow selection independent. A generated GLB fixture builds and updates both backends and renders 128 non-background pixels in isolated WebGPU and WebGL checks; WebGL compiles its color and shadow programs with no GL errors. This proves the generic component path, not real Tidewater output or FPS. Tidewater has not exported its fish-stand models to this format; its current engine-owned fish-prop adapters implement a specialized component and therefore do not count as renderer-neutral migration. The shoreline query adapter now belongs to ElseMesh and reads the same packaged shore field as WebGPU; Tidewater no longer selects it through a WebGL behavior hook. WebGL breaker-spray samples now derive from the active heightfield for both built-in and hosted worlds, without an IslandDefinition beach rectangle. Other backend-specific installers remain, and hosted WebGL presentation paths still contain world-specific behavior. Acceptance requires migrating real Tidewater content and checking matched output and gameplay in both renderers. |
| Tidewater gameplay and content parity: WebGPU baseline, WebGL aligned | **84%** | Tidewater has deterministic pre-split WebGPU cast, bite, fight, and boat traces plus WebGPU/WebGL fishing and fish-stand/boat checks in its own repository. The 171-frame WebGPU cast trace matches a golden executed from pre-split `FishingRod.js` at `23c30bf62aae2aefd0f2bcdd3edc650cf960ce3e`. A paired headless full-cycle trace now drives both renderer game paths through cast, authored bite schedule, hook, catch, and sale (519 bite frames, 1,199 fight frames). The paired renderer trace uses an in-process test extension and synthetic water query. A live Chromium/worldd test now drives both renderer game paths through cast input, bite, catch, inventory, and sale with separate Workers running the signed module. Its water query is synthetic, so it does not prove production water-query or rendered visual parity. The production-style isolated comparison is pinned to pre-split ElseMesh `23c30bf62aae2aefd0f2bcdd3edc650cf960ce3e` and uses packaged Tidewater terrain. On 13 shore/dock samples, WebGL query height MAE is 0.0094 m (max 0.0504 m), normal-component MAE 0.0045, and terrain-floor MAE 1.8e-7 m. The corrected CPU shore profile matches direct WebGPU displacement at 0.000013 m mean / 0.000056 m max; its Eulerian shore hook differs from WebGPU shore-only query by 0.0003 m mean / 0.0008 m max. A controlled 18-second moving-boat trace (production FFT and packaged shore, fixed 1/60 s input lead, no interactive wake/collisions) now ends 0.103 m apart, with max speed delta 0.012 m/s. Same-position water height along that trace differs by 0.0065 m mean / 0.0150 m max; FFT-only error is 0.0059 m mean / 0.0145 m max. The isolated correctness harness substitutes synchronous pixel readback and is not production async-readback or FPS evidence. Earlier direct WebGPU renders against the same pre-split commit were pixel-identical for four ocean views; six static island/pier views differed by at most 0.00543 RGB MAE, but neither is a live cross-renderer comparison. WebGL visible water now samples the shared FFT and hosted WebGL composes its package shore field. WebGL now has an engine-owned GPU WebGL2 `WakeSim` port. Its 512×512 RGBA32F working state and RGBA16F display/aeration outputs, plus RGBA16F 32×88 near-field, feed visible water displacement, slopes, foam, aeration, and `WebGLWaterQuery`. A deterministic SwiftShader harness exercises pressure, wash/bow generation, breaking and shallow surf, turbulence, piles, reader output, and idle priming. A full-page headless check confirms visible water and gameplay queries share the same wake textures and that the solver advances when the boat moves. The direct 48-frame WebGPU/WebGL field comparison now has display-field MAE at most 2.1e-7 (max 0.00061) and aeration MAE 6.84e-6 (max 0.060). A WebGL water-query check also returns the same -0.02363 m wake offset as the direct reader after 48 solver steps, and zero with wake disabled. The initial three-second production-order boat probe showed maximum position delta 0.003 m, speed delta 0.001 m/s, fixed-position water-height delta 0.0024 m, and normal delta 0.00867, but lacked collisions. It is superseded by an 18-second production-order probe with Tidewater pier colliders: maximum position delta 0.084 m, speed delta 0.0113 m/s, fixed-position water-height delta 0.01565 m, and normal delta 0.0253 (about 1.45 degrees); wake step counters differ by at most one. A Tidewater-owned source check now pins WakeSim, WaterQuery, BoatDesign, boat physics, berth, and pier inputs to the pre-split ElseMesh `23c30bf` baseline, normalizing only the extracted constants and world-supplied berth. The full parity script passes across all 18 one-second samples with a 0.03 normal-distance tolerance (about 1.72 degrees). The correctness harness uses synchronous WebGL readback and does not establish production async-readback cost or visual parity. Hosted WebGPU and WebGL captures now show the same signed Tidewater world at 1280×720 from the authored spawn. The first hosted captures were not valid for color comparison because the loading/tour overlay remained visible; the 2026-11-06 controlled comparison below supersedes them. Dynamic WebGPU auto-exposure and post-grading still need a separate parity check. The full renderer cannot initialize WebGPU on this host because Chromium reports adapter limits of 16 sampled textures and 4 storage textures per shader stage, below the renderer's requirements of 21 and 5; the isolated solver harness can still run the two wake solvers side by side. The captures are software-backed and not a synchronized comparison against pre-split WebGPU; their displayed FPS values are not hardware performance measurements. On 2026-11-07, the split WebGPU horizon band was reproduced in the isolated Weston review and removed by restoring the fresh per-frame camera uniform snapshots from `786c85e0`; the current WebGPU capture has an uninterrupted sky-to-sea horizon and visible wave spray ([capture](docs/images/elsemesh-webgpu-horizon-fix-2026-11-07.png)). This closes that known WebGPU regression, but it is not a matched WebGL/WebGPU or supported-hardware performance comparison. **Current gap:** capture matched live WebGL/WebGPU views and measure supported-hardware FPS. The software-backed full-page probe reported about 2 FPS and long frame stalls, so supported-hardware performance still needs measurement. Dynamic grading and remaining sky/lighting, shoreline, terrain, and wood differences also need comparison.

## Architecture assessment

The intended boundary is **not complete yet**. Registered world behavior code can call owner-signed JavaScript modules in dedicated Workers, and the signed event/result contract dispatches opted-in world-activation events through App. Isolated Chromium now verifies live signed-asset download from `worldd`, actual `App.activateHostedWorld()` dispatch, and `App.deactivateHostedWorld()` teardown with a real module Worker. A separate fixture checks the dispatcher using an in-memory signed package. The live test module is a focused fixture, not Tidewater's fishing module; input, interaction, and frame events are not wired, and arbitrary owner-defined results still need a world-side adapter to affect gameplay. Do not claim a complete autonomous Engine-managed world runtime yet.

ElseMesh is partly
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
fishing rod input transitions are now handled by Tidewater's shared
`FishingInputController` from both renderer adapters; frame simulation, vendor
interactions, and fishing presentation are still maintained in separate paths.
The static model instance-set format now has a signed asset resolver, shared
visibility/LOD runtime, and engine-owned WebGPU and WebGL adapters. A generated
GLB fixture checks installation, transformed geometry, instance updates,
separate shadow batches, and rendered pixels on both backends. Tidewater's
fish-stand export and fish-specific renderer have not migrated to this generic
component, so these generic renders do not prove real-world parity.

The configurable default-package binding is a partial boundary. `App.init()`
loads the default package only for a launch without a world link. Hosted WebGL
and linked WebGPU both skip the built-in package's world-state factory; the
WebGPU route is checked by `test/hosted-webgpu-routing.mjs`. `App.js` imports
`BuiltinWorldPresentation.js` only after the
built-in WebGPU route; the production build emits it as a separate chunk. The
default package supplies layout to App and WebGLFallback. App obtains built-in
vegetation from a package presentation hook; Tidewater owns both backend
implementations. The Tidewater-shaped `WorldLayout.js` and
`createWorldLayout.js` adapters have been removed from the engine.
A hosted WebGPU browser probe now reaches package activation and renders the
world after cold shader startup. A Dawn regression check covers lazy resource
creation before render passes. The start overlay was dismissed for the settled capture; the browser was
software-backed, so matched pixels and device performance remain unverified. Neither the static import boundary nor hosted WebGPU visual
parity is complete.

## Current work and next gates

- 2026-11-06: Tidewater's 26 fish-school species behavior records now live in
  `worlds/tidewater/FishSchoolProfile.js` and are exposed through its registered
  fish profile. The engine validates the generic school descriptors and reads
  them from the active profile; the fish-school simulation, movement modes, and
  renderer remain engine-owned. The Tidewater fish and reef headless rendering
  probes now live in the Tidewater repository. A direct comparison confirms every expanded
  descriptor is identical to the pre-change catalog. Fish-profile and fish
  runtime checks pass, as does the external production build. Population layout
  is still authored in `src/world/Fish.js`, so this removes one content table
  without claiming full fish-system separation. The registry-based estimate
  moves from 77% to 78%; renderer and gameplay parity percentages do not change.

- 2026-11-06: Tidewater's procedural terrain generator, ridge/stack/path data,
  and built-in runtime-state factory now live in the Tidewater world package.
  App obtains runtime state from the package presentation contract; the generic
  terrain renderer still consumes the world's generated CPU terrain. Tidewater
  reef placement, terrain/debris render probes, and the terrain-dependent life
  harness now reference the Tidewater-owned generator. The full client suite and
  external production build pass. The registry-based estimate moves from 80% to
  83%; renderer neutrality and gameplay visual parity do not change. The same
  suite exposed and fixed stale world-provider fixtures plus an incomplete WebGL
  render fixture. It also exposed per-frame camera-uniform allocation; frame
  matrices and vectors now retain their values, reducing avoidable churn.

- 2026-11-06: Tidewater's ordered fish population recipe now lives in
  `worlds/tidewater/FishSchoolPopulation.js` and registers independently from
  fish appearance. ElseMesh resolves generic reef, circle, drop-off, pier-end,
  pier-pile, and point zones, then uses the existing seeded `pickSpot()` and
  group creation path. A deterministic synthetic-habitat snapshot matches the
  pre-extraction 63 groups and 2,066 fish exactly. Tidewater's headless fish
  rendering probe passes with the new registry input, and the external build
  succeeds. World-specific group counts, beach coordinates, pier offsets, and
  pile-spacing parameters have left `src/world/Fish.js`; generic school
  simulation modes, habitat sampling, and GPU presentation remain there. The
  registry-based estimate moves from 78% to 80%; renderer and gameplay parity
  estimates do not change.

- 2026-11-06: `TerrainData` and `Rocks` no longer import the Tidewater
  `WorldLayout` adapter or read its module-global island values. `App` passes
  the layout supplied by the default world package through `IslandWorldState`
  and into `Rocks`; Tidewater tools and rendering fixtures pass their own
  layout explicitly.
  Tidewater owns both `worlds/tidewater/IslandDefinition.js` and the vector
  adaptation in `worlds/tidewater/layout.js`. The external production build
  passes. The procedural engine modules listed below still contain
  Tidewater-specific presentation, so this is one removed data dependency,
  not completion of the world boundary. The percentage remains 73%.

- 2026-11-06: `pierWalkableHeightAt()` now receives the active world layout
  from the WebGL fallback, and the Tidewater-owned fixture supplies Tidewater's
  layout explicitly. `PierSurface.js` no longer imports `IslandDefinition`.
  The remaining direct layout dependency at that point was vegetation scatter.
  No progress percentage changed; the external production build passes.

- 2026-11-06: Tidewater pier geometry no longer reads a module-global layout.
  `App` passes the package layout through `Village` to `buildPier`, and Tidewater
  fixtures/export tools pass it explicitly. `Village` no longer imports the
  pier's module-global geometry constant. The external production build passes;
  the focused Tidewater pier-surface fixture passes, but rendered pier geometry
  was not reviewed.

- 2026-11-06: `FishSchools` no longer imports the Tidewater layout adapter.
  `Reef` now receives the package layout and uses it for its center, pier zones,
  and swell direction; it passes the same layout to fish placement. Built-in and
  Tidewater fixtures/adapters supply their layout explicitly. Reef materials
  still have a static swell dependency. The deterministic CPU reef snapshot
  passes with 83,601 records (5,350,480 bytes), and the external production
  build passes.
  fish rendering and gameplay parity were not exercised in this slice.

- 2026-11-06: `DebrisPlacer` no longer imports the Tidewater layout adapter.
  `App` passes layout through `Debris`; Tidewater's world render fixture and
  export tool also provide it explicitly. Those Tidewater files now read their
  own package layout directly instead of importing the engine adapter. The
  external production build passes. The debris render fixture was not run, and
  no progress percentage changed.

- 2026-11-06: Reef swell code now receives the active world layout in both
  WebGPU material construction and Tidewater's WebGL reef shader. Generated
  shader modules are keyed by normalized swell direction, avoiding a
  module-global direction. The static reef rendering checks pass on both the
  headless WebGPU path and Tidewater's WebGL adapter; the external production
  build passes. These checks do not establish full visual parity.

- 2026-11-06: Moved the plain Tidewater `IslandDefinition` data from `src/world`
  to `worlds/tidewater/IslandDefinition.js`. Tidewater wildlife and parity
  fixtures import it from their own repository; `WorldLayout` and `PierSurface`
  consume the submodule-owned file. `App` now gets the selected layout through
  `defaultWorldPackage.presentation.layout`, and WebGLFallback no longer imports
  `IslandDefinition`. The external production build passes. Remaining coupling:
  procedural engine modules still import the Tidewater layout adapter and
  authored values directly.

- 2026-11-06: `App` now receives the built-in layout through
  `defaultWorldPackage.presentation.layout`; the WebGL fallback consumes the
  same injected layout and no longer imports `IslandDefinition`. The current
  default binding still imports `WorldLayout` from the engine, so moving the
  layout source itself into Tidewater remains open. The external production
  build is the next gate.

- 2026-11-06: WebGL breaker-spray placement now samples the active terrain
  heightfield at bounded world-space spacing for both built-in and hosted
  worlds; `IslandDefinition.beach` no longer controls this renderer path. The
  external production build passes. No visual capture was run, so particle
  density and shoreline appearance remain unverified.

- 2026-11-06: Built-in and hosted WebGL boats now run the shared
  `BoatSpray` generator against the WebGL particle sink; `WebGLSpray` tracks
  and resets per-frame requests using the same 32-request limit. The external
  production build passes. No tests or visual capture were run, so matching
  spray appearance and performance remain unverified.

- 2026-11-06: WebGL shoreline water-query setup now belongs to ElseMesh and
  binds automatically from the active terrain shore field and sea level.
  Tidewater removed its `shore-aware-boat/1` backend hook and behavior entry;
  WebGL shore-profile math moved to `src/fallback/WebGLShoreSurface.js`, and
  the world-owned parity fixtures import that engine adapter directly.
  `WebGLWaterQuery` now composes named surface-offset samplers, so future wake
  displacement can coexist with shore displacement. The external production
  build passes. No browser capture or tests were run, so runtime numerical
  parity remains to be rechecked.

- 2026-11-06: Built-in wildlife creation now crosses the default world package
  boundary: the Tidewater package supplies `createWildlife`, while `App` treats
  the returned runtime as optional. `src/world/BuiltinWorldPresentation.js` no
  longer imports Tidewater wildlife. The external production build passed.
  This removes one static content dependency from engine presentation code;
  `App` and the built-in WebGL renderer still retain other Tidewater-specific
  paths.

- 2026-11-06 source audit: WebGPU's production `WaterQuery.heightModule`
  composes FFT displacement, shoreline displacement, and
  `WakeSim.wakeDisplacement()` when the active surface has a wake. The
  production `WebGLWaterQuery` updates its GPU FFT and applies Tidewater's
  shore offset, but exposes no wake sampler or wake contribution. Both paths
  use the same `BoatController`; therefore the existing 18-second boat trace,
  which explicitly excludes interactive wake and collisions, does not verify
  live production boat parity. The next boat gate is a WebGL wake surface/query
  implementation with matching wake input to boat hydrostatics, then a live
  moving-boat trace including collisions. The parity estimate remains 82%.

- 2026-11-06: WebGL water now uses the renderer-neutral optical defaults and
  ports the pre-split WebGPU material's dielectric Fresnel, roughness-adjusted
  sky reflection, GGX direct glint, and depth-dependent sun/sky scattering. The
  shared atmosphere pass supplies the water's sky irradiance, and WebGL uses
  the renderer's current key-light direction/radiance. WebGL water, shore,
  terrain, and world hooks now advance from the engine's shared clamped frame
  time rather than wall time. In a fresh 1280×720 hosted capture at the named
  16.2 beach pose and 0.55 exposure, sea-region RGB MAE against pre-split
  WebGPU falls from 40.88 to 30.34 and full-frame MAE is 20.13; sky is 19.28
  and sand 7.16. The capture remains unsynchronized to a particular WebGPU
  frame, and this software-backed result does not establish hardware FPS. See
  the [hosted WebGL water capture](docs/images/tidewater-hosted-webgl-water-2026-11-06.png).
  Overall parity remains 82%.

- 2026-11-06: The WebGL renderer now builds the same transmittance,
  multiple-scattering, and sky-view LUTs as the WebGPU atmosphere from a shared
  renderer-neutral parameter module. The sky dome and water reflections sample
  that atmosphere instead of separate fixed gradients. At the matched 16.2
  beach pose and 0.55 exposure, hosted WebGL versus pre-split WebGPU sky-region
  RGB MAE falls from 59.76 to 19.26 (49.93 to 17.10 on pixels that are
  cloud-free in both captures); full-frame MAE falls from 41.45 to 22.70, and
  sand MAE remains about 7.2. Sea MAE is 40.88; water, spray, and cloud phases
  are not synchronized, so this is not a wave-phase or gameplay parity result.
  The capture is software-backed and does not establish hardware FPS. See the
  [hosted WebGL atmosphere capture](docs/images/tidewater-hosted-webgl-atmosphere-2026-11-06.png).
  Overall parity remains 82%.

- 2026-11-06: WebGL direct sun now uses the atmosphere's shared spectral
  extinction coefficients and illuminance instead of a fixed warm light. At
  Tidewater's 16.2 beach time its linear RGB radiance matches the WebGPU
  atmosphere readback within 0.05 per channel. A fresh isolated 1280×720
  hosted WebGL capture at the original 0.55 exposure reduces dry-sand RGB MAE
  against pre-split WebGPU from 52.99 to 7.50; full-frame MAE falls from 58.63
  to 41.45. Sky MAE remains 59.76 and sea MAE is 50.29, so this fixes the
  direct-light contribution without closing sky or water parity. The screenshots
  are not animation-phase or hardware-performance evidence; overall parity
  remains 82%. See `/var/tmp/elsemesh-webgl-shared-sun-beach.png` for the
  current local capture.

- 2026-11-06: Tested a headless WebGL-only exposure change from 0.55 to 1.05,
  keeping ACES and the signed world unchanged. At the controlled beach view,
  full-frame RGB MAE against pre-split WebGPU falls from 58.63 to 24.61 (sky
  59.77 to 25.16, sea 73.09 to 37.21, sand 52.99 to 13.78). At the separate
  wave-focused `surf` view, hosted WebGPU at exposure 0.55 versus WebGL at 1.05
  still differs by MAE 35.58 overall (sky 22.63, sea 46.22, sand 44.35); the
  WebGL shore sheet becomes overbright and covers inland sand. The global
  exposure change is therefore not a suitable parity fix. See the [beach
  exposure trial](docs/images/tidewater-hosted-webgl-beach-exposure-trial-2026-11-06.png),
  [hosted WebGPU surf](docs/images/tidewater-hosted-webgpu-surf-controlled-2026-11-06.png),
  and [WebGL surf exposure trial](docs/images/tidewater-hosted-webgl-surf-exposure-trial-2026-11-06.png).
  These captures are not animation-phase or hardware-performance evidence.
  The parity estimate remains 82%; next isolate WebGL sky/direct lighting from
  water and shoreline presentation.

- 2026-11-06: Repeated the live pre-split, hosted WebGPU, and hosted WebGL
  beach captures at 1280×720 after waiting for the loader to disappear and
  dismissing the start and Tidewater guide overlays. The named `beach` view
  fixes the camera pose and time of day at 16.2; app exposure is 0.55 and the
  WebGPU auto-exposure multiplier is fixed at 1. Pixel RGB MAE is 1.89 for
  current hosted WebGPU versus pre-split WebGPU (sky 0.59, sea 5.21, sand
  0.63). This verifies the WebGPU scene at this view against the pre-split
  baseline. Hosted WebGL at the same view and exposure differs substantially:
  MAE 58.63 overall (sky 59.77, sea 73.09, sand 52.99), with a visibly darker
  sky and sea and duller sand. That initial capture lacked the minimap; a later
  fix and live capture are recorded below. The captures are not synchronized
  to the same animation frame, so sea-phase comparison and hardware performance
  remain open. The earlier
  washed-out comparison was invalid: its loader/tour presentation had not been
  cleared. See the [pre-split WebGPU](docs/images/tidewater-presplit-webgpu-beach-controlled-2026-11-06.png),
  [hosted WebGPU](docs/images/tidewater-hosted-webgpu-beach-controlled-2026-11-06.png),
  and [hosted WebGL](docs/images/tidewater-hosted-webgl-beach-controlled-2026-11-06.png)
  captures. The overall parity estimate
  remains 82% because WebGL presentation and other gameplay/rendering gates are
  still open.

- 2026-11-06: Hosted WebGL now supplies Tidewater terrain, vendor, fishing-area,
  and player/vehicle data to the existing engine `WorldNavigator`. Its renderer
  independent map/compass presentation is updated by the Tidewater WebGL game
  adapter on each frame and disposed when that world behavior deactivates. The
  Tidewater WebGL adapter and hosted-terrain minimap checks pass, and the
  external production build passes. A live signed-world WebGL capture confirms
  the navigator is visible with its 640×640 map and markers populated; see the
  [hosted WebGL minimap capture](docs/images/tidewater-hosted-webgl-minimap-2026-11-06.png).
  This closes the minimap omission, but leaves the larger WebGL lighting,
  atmosphere, water, terrain, and wood gaps open; the overall estimate remains
  82%.

- 2026-11-06: Tidewater now authors a renderer-neutral `ground-detail-field/1`
  component from the same `DebrisPlacer.mask` used by the built-in world. The
  engine stores its RGBA density mask as a DEFLATE-compressed
  `ground-detail-density/1` asset and installs the existing camera-local
  WebGPU field through the generic component adapter. The 4 MiB mask compresses
  to 234 KiB; the complete package is 126.18 MiB of its 128 MiB limit. The
  deterministic Tidewater export test, density decoder/registration test, and
  isolated production build pass. A live signed-world headless WebGPU capture
  confirmed the hosted component installed and drew 49 field cells with no
  browser errors; the current frame has no black horizon band. This fixes the
  hosted WebGPU pebble-field omission and visually rechecks the horizon after
  the camera-uniform rollback. Hosted WebGL now consumes the same signed density
  asset through its registered backend adapter. Its camera-local count was
  1,367 instances at the authored spawn, consistent with WebGPU's density and
  49 visible field cells. The WebGL runtime now allows components without a
  per-frame update method; a live headless run advanced beyond 1,300 renderer
  frames, confirmed all 39/39 package components installed, and captured the
  beach, pier, and fish stand. Tidewater's WebGL village-material adapter now
  awaits its asynchronous signed-map decoder, removing the last omitted
  component. Focused density and Tidewater adapter checks and the production
  build pass. This was SwiftShader software rendering, so it does not establish
  hardware FPS or matched pixels; spray is not visually confirmed, and a
  synchronized comparison against pre-split WebGPU is still required. The
  parity estimate remains 82%.

- 2026-11-05: A fresh hosted WebGPU review found that Tidewater's minimap frame
  hook could throw before `sceneRenderer.render()`: it read the built-in-only
  `app.terrainData` field and assumed terrain mask arrays that hosted heightfield
  data does not provide. The Tidewater minimap now reads `game.terrain` and
  treats those masks as optional, with a Tidewater-owned regression test. That
  removes this hosted frame-loop failure. At this checkpoint, the band and
  spray gates remained open pending a fresh WebGPU capture (recorded above).

- 2026-11-05: A visual bisect in an isolated worktree identified
  `add53b1d` (`perf(renderer): reuse camera frame uniforms`) as the first bad
  WebGPU revision: it showed both the black horizon band and missing wave
  spray. Its parent, `f04b00e9`, showed neither. Restoring fresh per-frame
  camera uniform values removed both defects in the source preview and
  production build; the fix is pushed as `786c85e0`. The allocation cost of
  this rollback has not yet been measured, so FPS parity remains open.

- 2026-11-05: Tidewater's live signed-Worker test now exercises the real
  `App.activateHostedWorld()` path for WebGPU, drives cast/bite/fight/catch/sale
  through App frame hooks, then deactivates and re-enters with a fresh Worker.
  A post-re-entry frame routes rod-toggle input and Tidewater gameplay. WebGL
  continues through its own registered gameplay hook and matches the same
  deterministic result. The live browser test and pre-split fishing/render
  parity suite pass. This closes the live App activation/re-entry gate; vendor
  interaction and broader renderer parity remain open.

- 2026-11-05: A matched Weston WebGPU comparison of the pre-split Tidewater
  build and hosted ElseMesh confirms two remaining content/presentation gaps:
  the original has beach pebbles that the hosted world lacks, and the original
  sky/sea look slightly bluer. The Tidewater package's
  [`world-source.json`](worlds/tidewater/world-source.json) declares no debris
  or pebble component; the built-in route instead constructs
  [`Debris`](src/world/Debris.js), which adds `PebbleField`. The fix belongs in
  Tidewater-authored renderer-neutral content plus an engine-owned generic
  renderer path, not in Tidewater-specific `App.js` logic. Source comparison
  found the atmosphere and environment implementations unchanged; the
  `Sky.js` change only forwards the frame uniform block, and the water changes
  concern pipeline-key caching and world sea-level use. These differences do
  not yet explain the color shift, so compare live sky/water inputs and pixels
  before changing color math. A concurrent 15-second sample counted 98 hosted
  ElseMesh engine frames (6.53 FPS) and 102 original Tidewater frames (6.80
  FPS), while the HUDs ended at 7 and 13 FPS. The original HUD accumulates
  engine `dt` after its 100 ms clamp, so it omits long stalls from its time
  denominator; future performance comparisons must count engine frames over a
  matched wall-clock interval. No parity percentage changes: missing pebbles,
  unexplained color differences, and WebGL comparison gates remain open.

- 2026-11-05: The original's wave spray and fine mist were missing from hosted
  WebGPU because that bootstrap never created `Spray`, and its separate frame
  loop never advanced the hosted breakers or spray. Hosted island oceans now
  create the shared particle system and advance the same ocean-frame updater as
  built-in play, with one water-query update per frame. Focused routing/frame
  checks and the external production build pass. The isolated live WebGPU page
  now advances the spray simulation (536 frames observed), compiles its update
  kernel, and renders spray off 577 breaker stations without browser exceptions.
  The estimate remains 82%: this closes a confirmed hosted-WebGPU surf defect,
  while pebbles, color matching, WebGL parity, and full gameplay/performance
  comparison remain open.

- 2026-11-05: Hosted WebGL now extracts connected shoreline stations from the
  packaged terrain and shore field, then updates a GPU-rendered breaker lip
  from the same phase, amplitude, depth, and crest equations used by WebGPU.
  The CPU state test confirms the crest follows simulation time; an isolated
  Chromium WebGL render compiles the shader and reports 1,937 pixels changed by
  the lip against the water-only baseline. The existing WebGL water/shore phase
  render and terrain material checks pass. This closes the missing-lip
  implementation gap for hosted WebGL, but does not yet prove matched appearance
  against hosted or pre-split WebGPU; spray, foam, roughness, and full-scene
  comparison remain open. The parity estimate stays 82%.

- 2026-11-05: Captured hosted WebGPU and WebGL at the same signed Tidewater
  world, `view=beach` pose/time, and 1588×867 review viewport in the isolated
  Weston display. The WebGL capture still has a sharper, longer shore-foam
  line and more visible spray points; the hosted WebGPU surf is smoother in
  this view. These captures show a live visual gap after the shared phase fix,
  but do not compare against the pre-split build or establish performance.
  See [hosted WebGPU](docs/images/hosted-tidewater-parity-webgpu-2026-11-05.png)
  and [hosted WebGL](docs/images/hosted-tidewater-parity-webgl-2026-11-05.png).
  The 82% parity estimate remains unchanged.

- 2026-11-05: WebGL's visible shore waves now include the rip-channel phase
  offset already used by the WebGPU shore waves and WebGL spray. Water and
  spray use one WebGL phase function, and an isolated WebGL render checks that
  function against the shared CPU shore calculation, including rip channels.
  This removes a source of crest/spray timing differences; simulated spray and
  matched visual parity remain open.
  The parity estimate remains 82%.

- 2026-11-05: Fixed WebGL startup for worlds that omit the optional sky or
  explicitly select `sky: none`. Lighting initialization now accepts the
  absence of an environment map; a hosted initialization fixture exercises
  both cases through the real fallback initialization path. This closes a
  world-agnostic startup defect, but the remaining separation gates are still
  open, so the 69% estimate is unchanged.

- 2026-11-05: A hosted WebGL beach capture isolated the long sand bands to the
  terrain mesh casting shadows: disabling terrain shadow casting removes the
  bands while retaining its shadow reception. Hosted terrain now disables
  `castShadow` and keeps `receiveShadow` enabled; the focused terrain check
  asserts both roles. The visual comparison used the same live scene and changed
  only the terrain caster flag. See [post-fix hosted WebGL beach capture](docs/images/hosted-tidewater-webgl-terrain-shadow-fix-2026-11-05.png).
  This removes a hosted WebGL artifact; broader renderer and pre-split parity
  remain open, so the estimate stays 82%.

- 2026-11-05: WebGL now builds a sky-only cubemap from its existing cloud/sky
  shader, GGX-prefilters it, and assigns it as the renderer scene environment.
  This lets the existing wetness-dependent terrain roughness produce the same
  class of sky specular response as WebGPU, without world-specific reflection
  code. A synthetic WebGL2 render confirms that the environment changes terrain
  shading and that lowering roughness sharpens reflected sky; the test exercises
  sun and cloud refreshes. A glossy-versus-rough render fixture reports a sum of
  absolute RGB-channel differences of 11,374. A hosted Tidewater capture at the
  authored beach view confirms the terrain has an environment response; a
  frozen with/without comparison shows a clear beach-pixel change. See
  [hosted WebGL sky IBL capture](docs/images/hosted-tidewater-webgl-sky-ibl-2026-11-05.png).
  The capture is not synchronized against the pre-split WebGPU image, and WebGL
  still differs in water, beach materials, and post-processing. The renderer
  test and production build pass; visual parity remains open and the estimate
  stays 82%.

- 2026-11-05 (earlier checkpoint): Hosted WebGPU now creates and advances its
  own `ShoreSim`, rather than depending on the built-in island simulation.
  WebGL terrain now has a
  persistent half-float GPU wetness field with the same 28-second drying
  constant and shoreline run-up coverage; focused material and isolated GPU
  render checks pass, including sand wetting and rock exclusion. This does not
  yet establish matched live wetness visuals. Wet terrain in hosted WebGPU gets
  environment specular from ElseMesh's environment lighting as its roughness
  falls. At this checkpoint WebGL still had no terrain environment probe; the
  subsequent 2026-11-05 checkpoint above adds sky-only IBL to WebGL, so that
  specific implementation gap is closed. Matched visual parity remains open
  and the estimate stays 82%.

The default world package is dynamically loaded only for built-in play. Its
presentation factory dynamically loads Tidewater's `WorldState`, which now
owns the procedural CPU terrain generator; ElseMesh still renders that data
through its generic terrain path. An isolated Chromium WebGL fixture rendered
128 non-background pixels with no GL errors. Hosted WebGL and WebGPU skip the
built-in package's world-state factory; a focused route check covers WebGPU. An isolated hosted WebGPU
run now renders the pier, fish stand, terrain, and ocean after shader warm-up,
with no console errors. The renderer test reproduces the former nested mipmap
pass and confirms lazy resource preparation happens before the render pass.
The start overlay was dismissed, but the capture used software-backed Chromium
and does not establish visual parity or hardware FPS. Hosted lifecycle teardown
tolerates absent built-in ocean, lighting, and wake services. A manifest-selected
world-provider loader restores only registrations needed by hosted packages.
`App.js` dynamically imports `WorldLayout` only for built-in launches,
`WebGLFallback` dynamically imports `IslandDefinition` only from its built-in
`_loadIsland()` path, and WebGPU loads `BuiltinWorldPresentation.js` only for
built-in play. Generic `Player`/`SoundScape` receive optional layout data
from callers instead of importing `WorldLayout`; `Player` also takes helm location
from the vehicle design instead of Tidewater `BoatSpecs`. The boundary test checks these source-level dependencies; focused Player,
hosted handoff, audio, and WebGL backend checks pass. App no longer statically pulls the built-in WebGPU presentation module into
its hosted path. Tidewater-specific rendering remains in the WebGL fallback,
fish-prop classes, and world component installers.
Remaining: remove remaining static imports of built-in content from generic
launch code, capture synchronized settled hosted WebGPU/WebGL views against the
pre-split baseline, and prove gameplay and performance parity.

The build now discovers lightweight provider descriptors from mounted world
repositories instead of naming Tidewater in engine build configuration. The
provider and backend-registry checks, external production build, and full client
suite pass with this discovery path. Hosted WebGPU now bypasses built-in
island construction and renders after cold shader startup; static content imports
and matched renderer parity remain engine/world separation gaps.

Earlier commits ElseMesh `69e8805` and Tidewater `4896050` moved WebGPU
component installers into Tidewater and dispatched them through the registry.
The current v3 cleanup removes obsolete local migration aliases in Blender and
`worldd` profile handling. The Hogwarts submodule is reported dirty and is outside this work;
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

The current signed stand asset contains 78 placements across 18 kind/species
geometry groups. A fresh decode of the checked-in asset found 71 distinct
kind/species/curl/sag/jaw combinations, 60 lengths, and 24 distinct material
flag tuples. Each record also carries pattern seed and wet/dried/blood/cloudy-eye
values that affect the existing mesh or material. The generic static-model
instance-set currently accepts only a model reference and transform per
instance. A valid migration therefore needs a generic, renderer-neutral way to
represent those per-instance model/material inputs (or authored model variants)
while retaining instancing, per-item culling, LOD, and shadows. The existing
asset cannot be converted by mapping only its positions and rotations.

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

- 2026-11-04: moved the Tidewater fish-prop WebGPU and WebGL backend adapters
  into ElseMesh and registered their component in the engine. The Tidewater
  WebGPU/WebGL adapter-construction checks and source-to-manifest test pass.
  This keeps renderer selection in ElseMesh but makes the engine own a
  fish-specific component, so it does not satisfy renderer-neutral world data
  or Tidewater-independent engine behavior. The checks create meshes and GPU
  buffers only; they do not render pixels, establish fish-stand visual parity,
  or verify FPS. No progress estimate changes. The next migration needs to
  export the stand as the generic static-model instance-set while preserving
  the authored appearance, per-item culling, shadows, and distance LOD.

- 2026-11-04: the shared renderer setup changes now cache static GLTF node
  matrices while refreshing them at embedded-collider registration, so
  world-setup transform edits remain reflected in collision. The full client
  suite passed, including generic WebGPU/WebGL static-model render checks and
  `world-collision`; the external production build passed. These checks do not
  exercise Tidewater's full fish-prop appearance or close a visual parity gate,
  so no separation or parity estimate changed.

- 2026-11-04: hosted WebGL terrain now consumes the signed terrain package's
  roughness and wet-darken values. Its dynamic swash now reads the packaged
  shore-arrival field and uses the WebGL water path's run-up timing; the static
  mottled damp term still uses the WebGPU range midpoint (0.36). Focused
  material, terrain-profile, and shore-field tests pass. The shared review
  display is currently owned by a Hogwarts review, so this change has not had a
  matched visual capture; shoreline/material parity remains open and the
  estimate stays 82%.

- 2026-11-04: WebGL terrain wet shading now follows WebGPU's damp mottle, dry-edge
  breakup, saturated dark albedo, rill modulation, and wet roughness equations.
  The moving wetness source remains WebGL's analytic shore-arrival estimate; it
  does not consume WebGPU's ShoreSim state. The focused terrain material check,
  external production build, and an isolated hosted WebGL capture pass. The
  capture does not compare matched WebGPU/WebGL wetness state, so no visual
  parity gate or percentage changes; dynamic wet-sand parity remains open.

- 2026-11-04: tightened the WebGL wet-sand mask to match WebGPU's sand coverage,
  rock exclusion, and jungle suppression inputs. The CPU-built terrain mask now
  supplies rock and jungle weights to the shader; dynamic wetness still comes
  from the analytic shore estimate rather than WebGPU's persistent ShoreSim
  channel. The focused terrain material test and external production build pass.
  An isolated Chromium WebGL render of synthetic sand and rock confirms that
  wet darkening changes the sand and leaves the rock unchanged. Tidewater
  visual parity remains unverified and the estimate stays 82%.

- 2026-11-04: checked precision for a WebGL GPU wetness field. With the
  WebGPU simulation's 28-second drying time and a 1/60-second step, a wetness
  of 1 decays to approximately 0.999405. Rounding each step to an 8-bit
  normalized channel returns 1, so that representation can remain saturated
  indefinitely. A 16-bit normalized value retains the first step (approximately
  0.999405); the final GPU implementation still needs suitable precision,
  coverage generation, and a matched rendering check. No percentage changes.

- 2026-11-04: isolated the WebGL terrain patch by capturing the hosted world
  with `noWater`; the pale geometry remained with the water scene disabled. The
  manifest's full terrain replaces a `portal-preview` terrain. WebGL had loaded
  both objects but did not hide the placeholder as WebGPU's package path does.
  Added a post-load replacement visibility reconciliation to hosted WebGL
  object installation, plus a regression test for both arrival orders. The
  focused visibility test and WebGL backend test pass. A fresh
  same-pose, same-time, 1588×780 WebGL capture no longer shows the overlapping
  terrain pattern. The remaining terrain is still much paler than WebGPU, and
  shoreline and foliage parity remain open. Estimate remains 82%; no visual
  parity gate has passed.

- 2026-11-04: captured the hosted Tidewater world in the same isolated Weston
  session at the same camera pose, time of day, and native 1588×780 viewport in
  WebGPU and WebGL. The WebGPU view retains detailed terrain/foliage, blue water,
  and visible wet-sand reflections. WebGL shows broad pale/white beach areas,
  simpler foliage, and brighter, more jagged shoreline foam. This confirms a
  substantial live visual gap between the current backends; neither screenshot
  is the pre-split baseline. The displayed 13 FPS and 6 FPS are brief overlay
  samples, not controlled performance measurements. Hosted WebGPU now honors the
  same debug camera pose as WebGL, with focused camera/routing tests passing.
  No parity percentage changes: the visual acceptance gate remains open.

- 2026-11-04: Corrected the prior tone-mapping change after source review showed
  WebGPU uses ACES filmic, not Reinhard. WebGL is back on ACES filmic with the
  live app exposure. The saved Reinhard capture is explicitly invalid as parity
  evidence. WebGPU's GPU-metered auto-exposure and grading, vignette, grain, and
  output transfer are still not shared with WebGL. No parity gate closed and
  the estimate remains 82%; visible parity, production GPU query, boat
  interactions, and hardware performance remain open.

- 2026-11-04: extended `test:live-fishing-extension-browser` to drive both the
  WebGPU `Game.update()` and WebGL adapter paths through cast input, bite, catch,
  inventory, and sale while each uses a separate dedicated Worker running the
  signed module fetched from a live `worldd` gateway. The isolated Chromium
  test passes with matching traces. It uses a synthetic water query, so live
  production query and rendered output parity remain open. Estimate moves from
  81% to 82%.
- 2026-11-04: extended the paired Tidewater fixture through an entire headless
  fishing sale using `Game.update()` and `WebGLGameAdapter.update()`: rod equip,
  charged cast, landing, authored bite schedule to take, input strike, fishing
  rule-module fight, catch, inventory, and sale. Both paths match exactly over 519
  bite frames and 1,199 fight frames. The historical cast golden and existing
  pre-split bite/fight and boat checks, plus WebGL adapter checks, pass. The
  test uses an in-process extension fixture and synthetic query, so it does
  not close live browser Worker/query, production boat/wake/collision, visual,
  or hardware FPS gates. Estimate moves from 80% to 81%.
- 2026-11-04: executed the pre-split `src/game/FishingRod.js` from
  `23c30bf62aae2aefd0f2bcdd3edc650cf960ce3e` with the same deterministic
  input edges, fixed-step cadence, query fixture, and renderless math adapters
  as the paired cast test. Its 171-frame trace matches current WebGPU and
  WebGL output exactly (SHA-256
  `cb90357158b6b5a157aeb7a6c3e727f10a1fe51c24eede0411cc47352771687d`). The
  parity estimate moves from 78% to 79%; full cast-to-sale integration,
  production boat/wake/collision behavior, live visual comparison, and hardware
  performance remain open.
- 2026-11-04: added a Tidewater-owned paired cast trace that drives the
  retained WebGPU `Game.update()` path and Tidewater's WebGL adapter through rod
  equip, charging, cast flight, water landing, Worker bite start, and retrieval
  cancellation. All state matches across 171 fixed-step frames. The paired
  fishing trace now continues through sale and compares proceeds, inventory,
  audio, and toast output. These establish WebGPU/WebGL alignment for the
  exercised paths, but there is no historical pre-split cast golden yet;
  production boat/wake/collision and hardware gates remain open. The gameplay
  estimate remains 78%.
- 2026-11-04: Tidewater's WebGL game adapter now matches WebGPU's walk-only
  vendor access and coin cue on successful fish sales. Its focused adapter test,
  the paired 987-frame WebGPU/WebGL fight trace, pre-split bite/fight goldens,
  and external production build pass. The gameplay estimate remains 78% because
  full cast-to-sale flow, matched boat behavior with wake/collisions, and
  hardware runtime measurements remain open.
- 2026-11-04: moved App's built-in Village, Reef, boat, debris, wildlife, and
  whale constructors into `BuiltinWorldPresentation.js`, loaded only after the
  hosted WebGPU package-only branch has returned. The source-boundary check
  passes, and the external production build emits a separate
  `BuiltinWorldPresentation` chunk plus a dynamic import from the App bundle.
  This removes that content graph from hosted App startup; WebGL and fish-prop
  world coupling remains, so the engine/world boundary estimate moves from 60%
  to 62%.
- 2026-11-04: added an isolated Chromium integration against a live `worldd`
  gateway. The test signs and imports a JavaScript behavior asset, uses
  OS-assigned HTTP/P2P and Vite ports, downloads and hash-verifies the asset
  through the browser gateway, invokes `App.activateHostedWorld()`, receives
  the subscribed activation result from a real module Worker, then invokes
  `App.deactivateHostedWorld()` and verifies the extension is disposed. Both
  the in-memory Worker browser test and live-gateway test pass. The fixture
  does not yet run Tidewater's fishing module or send input/interaction/frame
  events; the Worker estimate moves from 75% to 82%.
- 2026-11-04: expanded the isolated Chromium extension check to route the
  signed activation event through App into the real module Worker and validate
  its result through the behavior registry. The hosted lifecycle test now
  exercises `activateHostedWorld()`/`deactivateHostedWorld()` and confirms
  Worker termination with a fake Worker. Both checks pass. They still use an
  in-memory signed package and do not prove live gateway transfer or a real
  Worker through world departure; the estimate moves from 72% to 75%.
- 2026-11-04: added signed extension event subscriptions and routed the
  built-in/hosted activation event through App. Focused behavior-registry,
  experience-schema, Worker, `worldd` validation, isolated Chromium Worker,
  and external production-build checks passed. The browser integration still
  uses an in-memory package; live gateway download, hosted activation, and
  world-departure teardown remain unverified. This supports raising the
  Worker/event estimate from 65% to 72%, not completion.
- 2026-11-04: the full client suite and external production build passed after
  restoring the Tidewater terrain `surfaceProfile` through the deterministic
  exporter. The profile is now sourced only from Tidewater `world-source.json`
  and survives regenerated package data; the old duplicate in `presentation.json`
  was removed. WebGPU/WebGL fishing parity (987 frames), pre-split WebGPU fishing
  and bite traces (987/2,400 frames), and pre-split boat gameplay parity passed.
  The isolated WebGL water render changed 9,268 pixels. Scene, fullscreen, and
  mipmap render passes now close in `finally`, with an
  exception-path regression test;
  this prevents a thrown recorder callback from leaving the shared encoder
  locked, but does not prove the original hosted black-frame cause is fixed.
  The hosted WebGPU visual capture and live cross-renderer comparison remain
  open, so the parity estimate remains 78%.
- 2026-11-04: reran `node test/world-behavior-registry.mjs` and
  `node test/world-javascript-extension.mjs`; both passed. The isolated
  Chromium Worker check also passed owner-signature verification, package
  loading, and stateful execution in a real module Worker. Its fixture supplies
  the package in memory, so it still does not verify a live gateway download or
  `App.activateHostedWorld`. Vite printed a dependency-scan warning because
  this standalone test server does not load ElseMesh's virtual-module plugin;
  the browser test completed successfully. The test removed its isolated
  profile and its Chromium process exited.
- 2026-11-03: source review found the progress description lagged behind commit
  `1682b1f7` (2026-10-31). Linked WebGPU startup now branches to
  `initHostedPackageWorld()` before `initializeIslandWorldState()`; the
  `test/hosted-webgpu-routing.mjs` fixture verifies this branch, but stubs the
  hosted bootstrap and does not prove package rendering. The last saved hosted
  WebGPU capture is from source revision `9aa98aac` and is black
  (`/var/tmp/elsemesh-hosted-webgpu/tidewater-playing.png`); its browser console
  reported a command encoder locked while the `opaque` render pass was open.
  The later hosted startup path has not been captured in a browser. Static
  built-in imports in `App.js` also remain.
- 2026-10-30: reran Tidewater renderer gameplay and pre-split baseline traces in
  the external build tree. The WebGPU/WebGL fishing encounter matched exactly
  for 987 frames; pre-split bite/fight traces passed at 2,400/987 frames; and
  the boat gameplay rule trace matched frame by frame. Reran the isolated
  WebGPU/WebGL packaged-shore and underway-boat browser comparison: 13-point
  height MAE 0.0094 m, max 0.0504 m, and 18-second boat endpoint delta 0.103 m
  with max speed delta 0.012 m/s. These checks do not render the visible WebGL
  water parity target. A subsequent shader change bound the visible WebGL mesh
  to the WebGL FFT displacement texture and derives its fragment normals from
  the displaced geometry. Its isolated 192×144 render compiled all five
  programs without GL errors and FFT changed 9,268 pixels. This does not verify
  hosted-scene visual parity: foam/color, synchronized phase, and comparison to
  the retained pre-split WebGPU baseline remain open. Full client tests,
  production build, and Go server tests passed; the focused water render and
  final production build passed after the geometry-normal change.
- 2026-10-30: hosted WebGL now converts the signed terrain package's shore field
  into its shoreline shader textures and derives the high-resolution patch from
  the packaged sand/height mask instead of built-in island coordinates. The
  isolated browser loaded the hosted world with two water meshes and no
  unsupported components. The matched pier capture still shows visible
  water/shore/material differences. Hosted WebGPU startup is blocked by the
  built-in Tidewater `Village`/`Props` initialization failure recorded below;
  parity remains 78%. The focused shore-data check, full client
  suite, and external production build passed.
- 2026-10-30: an isolated Chromium hosted-world run confirmed the WebGPU startup
  failure is an engine/world initialization coupling, not an absent browser GPU
  API. WebGPU startup reaches built-in Tidewater `Village`/`Props` with no local
  world fish-presentation profile and throws on `PLACEMENT` before loading the
  hosted package. The hosted WebGPU capture gate remains open; remove built-in
  world construction from hosted startup before resuming visual comparison.
- 2026-10-30: reran `test/world-javascript-extension-browser.mjs` in isolated Chromium; owner signing, package assembly, stateful Worker execution, and browser cleanup passed. The test uses a local in-page connector fixture and direct Worker-manager calls, so it does not prove live gateway transfer or hosted-world activation.
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
  data/ZeroTier profile migration aliases. Blender identity checks,
  `go test ./...`, the full client suite, and external build passed.
- 2026-10-30: hosted package collisions are now allocated separately from
  `IslandWorldState`; WebGL hosted player, wildlife, and manifest blockers use
  the App-owned hosted collider set. Hosted player/collision checks, the full
  client suite (including isolated WebGPU/WebGL render fixtures and gateway
  E2Es), and the external production build passed. Hosted `App.init()` still
  constructs `IslandWorldState`, so this does not yet establish an independent
  hosted runtime.
- 2026-10-30: the isolated browser extension check now creates an Ed25519 owner,
  signs a valid v3 manifest with a content-addressed `javascript/1` asset,
  verifies it through `verifySignedWorldManifest`, assembles the package, and
  runs its unregistered behavior in the dedicated Worker. The live gateway
  download and `App.activateHostedWorld` integration remain unverified.
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
- 2026-11-04: removed the Tidewater-only `pierRail` allowlist from generic
  source, client, package, and Go collision validation; collision tags now use
  a shared bounded token contract that world behaviors interpret. Loading
  stage keys are likewise bounded owner-defined tokens. Moved the tropical
  vegetation binary-format document into Tidewater and made the engine schema
  docs world-neutral. Focused source/experience/collision checks, Tidewater
  source conversion, and Go manifest tests pass. The estimate remains 62%
  because Tidewater-specific renderers and installers are still in engine
  runtime paths.
- 2026-11-04: moved the tropical vegetation placement codec into the Tidewater
  repository and registered its decoder through the generic component asset
  codec registry. The Tidewater installer and WebGL fallback both use that
  registration; the fallback no longer imports the Tidewater codec. Codec,
  vegetation parity, source-manifest, export, WebGL adapter, and portal checks
  pass. The estimate remains 62% because WebGLFallback still owns the species-
  specific plant geometry, materials, and LOD behavior.
- 2026-11-04: moved Tidewater WebGL vegetation group construction and its
  batch adapter out of `src/fallback` into the Tidewater repository. Built-in
  WebGL resolves the placement URL by content-addressed asset ID and invokes
  the registered adapter; hosted WebGL passes the owner-declared asset kind.
  The placement seed is now authored in component data. Focused adapter,
  manifest, codec, vegetation parity, export, and renderer-boundary checks
  pass. Raised registry-based separation from 62% to 64%. Remaining: the
  procedural plant geometry and WebGPU vegetation implementation still
  reside in engine modules; matched renderer visuals remain unverified.

- 2026-11-04: moved WebGL village material decoding/presentation into a
  Tidewater-owned backend adapter. WebGLFallback now applies generic component
  presentation hooks to already-loaded and streamed model LODs and has no
  village-material import or component-type branch. Tidewater adapter source
  check and focused fallback/registry checks pass. Raised registry-based
  separation from 64% to 65%; other Tidewater renderer dependencies remain.

- 2026-11-04: moved the WebGL reef renderer, batch adapter, and focused
  codec/renderer tests into Tidewater. Built-in WebGL now discovers and loads
  registered component batch adapters by component type, and updates their
  returned runtimes; vegetation uses the same generic path. The WebGL fallback
  no longer imports the reef renderer, decoder, or component ID. A Vite package
  loader check proves reef and vegetation placements resolve from the shared
  URL index. Reef codec, renderer/LOD/culling, vegetation adapter, registry,
  and provider-loader checks pass. Raised registry-based separation from 65% to
  66%; Reef simulation and geometry remain coupled to the built-in engine
  implementation.
- 2026-11-04: moved Tidewater's fish-prop component contract and WebGPU/WebGL
  adapters into the Tidewater provider. The engine no longer globally
  registers the fish-specific component or imports its renderer adapters;
  WebGL now uses the generic component batch-runtime lifecycle. Added a
  boundary check that verifies the component and adapters appear only after
  loading Tidewater's provider. Raised registry-based separation from 68% to
  69%. Fish geometry/material code remains engine-owned, and this specialized
  placement format has not yet migrated to generic static-model LOD assets.

- 2026-11-06: removed the vegetation scatterer's final direct `WorldLayout`
  import. Tidewater now authors its bay region, protected plant-free corridor,
  and fallback boardwalk path in `IslandDefinition.js`; the engine receives
  those values through `worldLayout`. Updated built-in, Tidewater-provider,
  export, and fixture callers. This removes a remaining data dependency, but
  procedural plant geometry and WebGPU presentation remain Tidewater-specific
  engine code, so the registry-separation estimate remains 73%. Tidewater
  vegetation parity and the source-boundary check pass, and the external
  production build succeeds. The unrelated dirty `RefractionPass.js` change
  was excluded from this slice.

- 2026-11-06: moved the island-layout vector conversion from the engine's
  `createWorldLayout.js` into Tidewater's `layout.js`, then removed the
  Tidewater-shaped adapter from `src/world`. Tidewater now owns its layout
  definition and its conversion to the engine math types; the engine has no
  layout adapter with island-specific fields. The registry-separation estimate
  remained 73% at this point because renderer and gameplay content still reside in engine
  modules. Tidewater placement parity and the backend-registry boundary check
  pass, and the external production build succeeds.

- 2026-11-06: moved the complete Tidewater WebGPU vegetation implementation
  (placement, species geometry, materials, LOD, impostors, and grass) into the
  Tidewater repository. Built-in App now asks its injected world package for
  the renderer, and Tidewater hosted component installation uses the same
  owner-side module; WebGL presentation and geometry are also world-owned.
  Moved the vegetation headless fixtures into Tidewater. Module import, source
  placement parity, component registry, WebGPU headless vegetation build, and
  default-package asset checks pass. Raising registry-based separation from
  73% to 77%. Matched rendered visuals and device performance remain unverified.

- 2026-11-06: added `?simtime=<seconds>` to hold simulation-driven animation
  at a repeatable time for renderer comparisons. Fixed hosted WebGPU advancing
  the shared frame-time uniform twice; WebGPU, WebGL, and ocean FFT now use the
  same fixed clock when requested. Focused clock/routing checks, the full
  client suite, and external production build pass. Matched captures using
  this clock remain pending, so parity estimates do not change.

- 2026-11-06: checked the migrated fish behavior against the last committed
  pre-extraction `Fish.js` (`c32a293d`). All 26 effective species profiles
  match its normalized snapshot exactly. Barracuda did not define `flee`; it
  inherited the shared 3.5 m reaction distance. Tidewater's owned parity test
  now asserts both the full profile hash and that value. The 63-group seeded
  population snapshot passes; no estimate changes.

- 2026-11-06: audited production boat-water wiring after the fixed-clock work.
  WebGPU `WakeSim` contributes to both rendered water and `WaterQuery`; the
  WebGL fallback has no wake simulation, wake renderer contribution, or wake
  term in `WebGLWaterQuery`. Existing production-style boat traces explicitly
  exclude interactive wake and collisions, while the synthetic sensitivity
  fixture does not exercise production wiring. This confirms an open gameplay
  and visual parity gap. The parity estimate remains 82%; implement and compare
  the engine-owned WebGL water-effect path before claiming boat parity.

- 2026-11-06: added an engine-owned WebGL wake trail sampled from the active
  boat controller. Its shared analytic height/foam functions feed visible
  WebGL water and the same height contribution is composed into
  `WebGLWaterQuery`; no Tidewater component hook is involved. CPU behavior,
  WebGLFallback water shader compile/render (wake changes 861 pixels in the
  controlled software render), FFT water rendering, and ocean adapter checks
  and the full external client suite pass. The production build also passes.
  A controlled 60 FPS probe found the sampler emitted only one point because
  its movement threshold compared consecutive frames; this is fixed and has a
  frame-paced regression check. A matched 240-frame software-WebGPU probe now
  samples WakeSim and WebGL at 32 world positions: height MAE is 0.0742 m
  (0.3244 m max), foam MAE is 0.199 (peak 0.760 vs 0.664). The analytic trail
  is still not a numerical match for WakeSim, and no wake-enabled production
  boat trace or matched scene capture has been run, so gameplay parity remains
  82%.
- 2026-11-06: extracted the shared 512x512 WakeSim grid, cell size, depth
  levels, window size, and near-field dimensions into a backend-neutral
  constants module. Added a WebGL2 RGBA32F radix-2 FFT primitive with 9
  draws per axis and fused bit reversal. The isolated headless WebGL2 harness
  passes an impulse transform, deterministic frequency bins, and unnormalized
  inverse scaling (N²). On SwiftShader, the deterministic spectrum error is
  3.02e-4 and round-trip error 1.663e-3, within recorded float32 tolerances.
  This is only the FFT primitive; the WebGL WakeSim physics, display/readers,
  query integration, and production parity checks remain open. Estimate stays
  82%.


- 2026-11-07: ported the WebGPU `WakeSim` physics, spectral update, display/aeration readers, and near-field handling to an engine-owned WebGL2 simulation, then connected that shared field to WebGL water and `WebGLWaterQuery`. The deterministic isolated GPU harness passes pressure, wash/bow, breaking/surf, turbulence, pile attenuation, aeration-reader, and sleep-priming checks. A full-page headless WebGL launch confirms both render and query paths reference the same textures and the simulation advances for a moving boat. During that launch, fixed a WebGL startup assumption that `swellDir` was an array when the world layout supplies a `Vector2`, and removed the stale analytic-wake GLSL insertion. The SwiftShader full-page probe reports about 2 FPS with long frame stalls; it is not a supported-hardware benchmark. A direct 48-frame WebGPU/WebGL field comparison drives the same boat through a speed increase and turn across a variable-depth shelf: display-field MAE is at most 2.1e-7 (max error at most 0.00061), and aeration MAE is 6.84e-6 (max 0.060). A separate WebGL water-query check returns the same -0.02363 m wake offset as the direct reader after 48 solver steps, and zero with wake disabled. The readback check exposed a missing WebGPU texture `COPY_SRC` usage; the two WakeSim output textures now permit diagnostic readback. The full external client build and full-page WebGL integration pass. The three-second packaged-shore production-order trace closes the initial wake-to-boat-query integration gate, moving gameplay parity from 82% to 83%. Its synchronous WebGL readback and no-collision fixture do not prove long-run coupling, collision response, rendered parity, dynamic grading, remaining scene differences, or supported-hardware FPS; those gates remain open.
- 2026-11-07: restored the camera-frame snapshot behavior from `786c85e0` after identifying that `5281da3c` reintroduced in-place updates in `setFrameCamera()`. A clean split WebGPU capture in the isolated Weston display showed the black horizon band gone and a small wave-spray plume visible. The capture is software-backed (about 9–11 FPS), so it verifies this visual regression only; matched WebGL/WebGPU output and supported-hardware performance remain open. The gameplay/content parity estimate moves from 83% to 84%.

- 2026-11-07: compared original `tidewater/main` (`4811ba48`) WebGPU against
  the locally signed Tidewater package on hosted WebGL at the named beach
  camera and time 16.2. The hosted package loaded its authored 1024×1024
  ground-detail density asset. WebGL now uses Tidewater main's 4 m blue-noise
  patch slots, category channels, hash-driven sizes, and distance fades. The
  beach shows fine grit instead of the previous oversized fallback stones.
  The WebGL camera was 0.177 m lower after player grounding, and its geometry
  and material remain approximate; this is not full pixel parity. See the
  [matched beach captures](docs/graphics-review.md#2026-11-07-tidewater-main-beach-grit-baseline).
  Overall parity remains 84%; water, lighting, terrain, wood, synchronized
  pixels, and supported-hardware performance remain open.
- 2026-11-07: compared the split WebGL beach at the named pose against the
  authoritative original `tidewater/main` WebGPU capture (`4811ba48`). The
  post-processing HDR target exposed an sRGB decode still being applied to
  linear screen color in the WebGL water shader. Making that decode conditional
  raised the same sea crop's mean RGB from (49.1, 76.5, 88.5) to (62.7, 94.6,
  107.4), toward the original's (87.6, 118.2, 127.8). The live WebGL2 shader
  reports no GL error. The camera remains 0.177 m lower and wave phase is not
  synchronized; this is a targeted fix, not full visual parity. The exposure
  meter now follows the original 1/16 bloom level. Gameplay/content parity
  remains 84%; water color and broader visual, gameplay, and hardware gates
  remain open. See the [review evidence](docs/graphics-review.md#2026-11-07-webgl-hdr-scene-color-water-correction).

- 2026-11-07: the live worldd-backed Tidewater browser check now routes E input through the registered WebGPU player-frame path and WebGL keydown hook, opens and closes Joe's buyer panel in both paths, and sells the caught fish while the panel is open. Both renderer paths still use separate dedicated Workers for the signed fishing module. This verifies the input-to-vendor flow in the integration fixture, not the authored vendor coordinates or a fully rendered walk-up. The owner-signed JavaScript worker estimate moves from 92% to 94%; renderer parity remains open.
