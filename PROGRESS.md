# ElseMesh progress

This is the dated implementation and verification log. Current priorities and
open product requirements are tracked in [PROJECT-DIRECTION.md](PROJECT-DIRECTION.md);
completed milestones are summarized in [GOAL-done.md](GOAL-done.md).

## 2026-10-29

- Removed the retired Wasm guard, worker, and `wasm/1` manifest validation. The
  publisher, world daemon, and browser now use bounded signed `javascript/1`
  modules in a dedicated Worker with UTF-8, message-size, startup, and execution
  limits. Hosted WebGPU and WebGL activation pass the generic Worker manager
  through registry hooks and dispose it with the world. The behavior registry
  now accepts an engine-unknown behavior only when the signed experience binds
  it to a Worker module; the module owns that behavior's event validation.
- Worker activation now sends a generic `initialize` message with the signed
  behavior data, exposes the result through `ready(behaviorId)`, and waits for
  successful initialization before dispatching later messages. The focused
  test verifies initialization ordering and data delivery.
- Tidewater's signed fishing module validates and compiles its authored
  bite-rate schedule and owns species selection, bite phases, weight rolls,
  catch-fight initialization, ordered frame steps, and cancellation inside the
  Worker. The WebGPU and WebGL runtimes exchange bounded JSON snapshots; the
  browser samples habitat and retains input, inventory, audio, and presentation.
  Casting and the fishing HUD still need separation work.
- Tidewater's fishing and shore-aware boat descriptors, including fishing
  experience-field validation and built-in runtime binding, now register from
  `worlds/tidewater/register-behavior.js`; the generic engine registry no longer
  imports or names those behaviors. The engine's fishing runtime is now a
  bounded Worker-request adapter; browser presentation and environment samples
  remain in the renderer.
- Moved Tidewater's `FishingGameRuntime` event vocabulary, request queues, and
  worker-result handling from `src/game/` into `worlds/tidewater/`. The generic
  engine registry test now uses a synthetic behavior and no longer imports
  Tidewater. Tidewater tests cover per-world runtime and save isolation, while
  the pre-split bite/fight and WebGPU/WebGL fishing traces continue to pass.
  Also moved Tidewater's `GameState`, `Gear`, and fish-catalog calculations
  into its world repository, with the standalone HUD review page beside the
  world tests. `Game`, rod controls, vendor presentation, and some fishing
  calculations still live in the engine and remain separation work.
- Tidewater's 18-species fishing catalog has moved from `src/game/FishTable.js`
  into `worlds/tidewater/fishing.json`; its values match the pre-split table
  exactly. Fish catalog validation, catch inventory, save, HUD, and fish-display
  calculations remain client-side; species selection and bite/fight mechanics
  execute in Tidewater's signed module. Fishing casting and fish model
  implementations still remain partly engine-owned.
- The focused Worker, registry, experience, manifest, and Go worldd tests pass;
  `npm run build` passes in the external build tree. The full `npm test` run
  passed through the engine smoke checks, then its gateway E2E could not find
  the required Go toolchain in its isolated module cache. Re-running that E2E
  with the installed toolchain cache and running the final browser-host test
  separately both passed.
- Tidewater package-specific export, authored collision, boat LOD, and Blender
  checks now live in `worlds/tidewater/test/` and pass from the engine runner.
- The paired fishing trace now drives the Tidewater module through both the
  retained WebGPU `Game` path and the WebGL adapter. Fight snapshots, terminal
  rod state, inventory, catch card, audio cues, and toasts match over a 987-frame
  encounter. Golden traces captured from the pre-split WebGPU bite simulation
  and `CatchMinigame` at `23c30bf` now match the signed Worker frame by frame for
  2400 bite frames and the 987-frame fight. The focused checks and Blender CLI
  confirm v3 `elsemesh:` world IDs are accepted and legacy `world:` IDs
  rejected. Boat parity, the broader fishing/input matrix, and visual parity
  remain open.
- `BoatGameplayRuntime` now matches the pre-split `Game.updateBoat` rules
  frame-by-frame for engine upgrades, fuel burn/depletion, one-shot out-of-fuel
  notification, stop-time persistence, and fish-finder sampling/visibility.
  This exposed and fixed a reboarding discrepancy: the separated runtime had
  discarded the last sonar result while the historical game retained it until
  the next 0.5 s sample. The new package test is
  `worlds/tidewater/test/pre-split-boat-gameplay-parity.mjs`. Boat-controller
  hydrodynamics and WebGPU/WebGL water-query trajectories still need matched
  runtime parity checks; this does not close the boat parity gate.
- The WebGL boat query now takes its simulation time from the renderer and lets
  the registered Tidewater shore-aware-boat behavior add Tidewater's depth-aware
  shore crest from the same shoreline field used by the WebGL water shader. At
  the default berth, the previous sine-only query differed from the shore-aware
  water height by 0.21 m at one fixed time and position. The 90-second idle-boat
  simulation remains upright (15.1° maximum tilt, 0.89 m/s maximum speed), and
  the production build, WebGL game adapter, registry, and pre-split boat-rules
  checks pass. This improves WebGL's local water/physics agreement but is not a
  matched WebGPU-vs-WebGL or pre-split hydrodynamics trace. The isolated Xvfb
  Chromium check could not create a WebGL2 context (blocklisted without DRI3);
  live WebGL visual review and full boat parity remain open.
- Moved `BoatGameplayRuntime` into Tidewater and delegated its engine-upgrade,
  fuel, and fish-finder rules to the signed Worker. The client supplies terrain
  and habitat samples and applies the returned fuel, throttle, save, and HUD
  results. Both renderers obtain the adapter through Tidewater's registered
  behavior runtime; neither engine adapter imports Tidewater boat rules.
  Boat-controller hydrodynamics and matched live renderer checks remain open.
- An earlier extension prototype used signed Wasm asset references. The active
  implementation uses JavaScript Workers; Wasm is not part of the plan.

## 2026-10-24

- WebGL whale LODs now cast shadows through a custom depth material that uses
  the same authored height relief and animated CPU rig pose as the visible
  whale. `worlds/tidewater/test/webgl-whale-package.mjs` verifies visible and depth shader
  injection and that all LODs use the matching shadow material. Vite now serves
  extensionless content-addressed world assets as raw bytes for runtime fetches
  while retaining URL-module handling for imports. The WebGL fallback now
  merges only iterable vegetation placement groups, exposes the shared water
  query `get(slot)` contract, and renders shared Whale spray emissions through
  a small CPU-backed point batch. `npm test` and `npm run build` pass. On
  2026-10-24, native Chrome on Flip7 rendered the WebGL world and Whale on
  isolated display 7; a forced blow emitted visible particles. This is a live
  feature smoke check, not matched visual parity. Standard WebGL lighting,
  accurate spray physics, and matched visual parity remain open. A separate
  Termux Chromium SwiftShader attempt still fails to create a context and is
  not used as the Android renderer result.

## 2026-10-20

- Remote startup selects unbounded records only through the `nearby` tier and
  preloads the initial asset set through `nearby`; view-driven streaming handles
  later content.
- Full remote-world shader precompilation and GPU warmup are deferred until
  after the first render-loop frame.
- Linux WebGPU defaults to Visual Quality. Saved FPS preferences and WebGL
  fallback retain the responsive profile; `?quality=1` remains an override.
- Boat controllers retain their presentation models for boarding and helm
  anchors. Player movement collides with solid boat geometry and hull sides.
- Browser reproduction reached `Boat · 3rd person` after direct helm entry
  without a render freeze.
- Focused streaming, backend, graphics-priority, and boat-collision tests pass.
- The production build passes in the required external build tree after
  `cpto` synchronization.

Remaining gates as of 2026-10-20: explicit bootstrap/readiness metadata, a
minimum-pipeline entry pass, spatial chunking for monolithic assets, and a
rendered remote-world test proving that background content continues loading
after entry.

## 2026-10-22

- Fixed the hosted frame loop so static components without an `update()` method
  do not stop rendering.
- Hosted terrain now activates terrain-dependent underwater and ground-bounce
  shader hooks using the packaged heightfield, avoiding duplicate built-in and
  hosted terrain bindings.
- Verified the Example Island on Flip7 Android 16 Chrome in an isolated
  720×1600 virtual display. The hosted and built-in views rendered at the same
  authored spawn pose, 16:12 time, and render scale; comparison frames and
  limits are recorded in [graphics-review.md](docs/graphics-review.md).
- Desktop comparison, other island views, fishing and wildlife authority,
  gameplay parity, and sustained performance acceptance remain open.

## 2026-10-23

- Enabled the documented review-camera and free-camera controls in hosted
  worlds. Hosted camera movement no longer gets overwritten by the player
  controller, and returning to the player uses hosted collision data.
- Compared hosted and built-in village views on the same isolated Flip7
  virtual display at pose `[62, 7, -62]`, yaw `0.34`, pitch `-0.12`, and time
  15:30. Both rendered; the hosted view visibly lacks the beach grass in the
  built-in view. The retained frames and comparison limits are in
  [graphics-review.md](docs/graphics-review.md).
- Repeated the village review after adding the portable grass-density asset.
  At the same pose, time, viewport, and render scale, beach grass is visible in
  both hosted and built-in renders; the signed hosted manifest contains the mask
  component. Full density and LOD parity, desktop comparison, fishing and
  wildlife authority, broader gameplay parity, and sustained performance
  acceptance remain open. Captures and limits are recorded in
  [graphics-review.md](docs/graphics-review.md).

- Added the portable `grass-density/1` asset contract and optional
  `grassMaskAssetId` reference for static vegetation. The CPU-only Tidewater
  updater produced a deterministic 4 MiB mask; source-to-manifest conversion
  verified its content hash, asset kind, and required feature. The client now
  installs it against the matching packaged terrain. The matched Flip7 review
  now confirms hosted beach grass renders; broader density and LOD parity
  remain open.
- Consolidated daemon builds into `tools/build-server.sh`. Its default target
  is ZeroTier-enabled `thruholdd`; an optional `worldd` target builds the
  CGO-free daemon for use with a host-managed ZeroTier service. The `all`
  target builds only the default world daemon plus directory and account
  daemons, avoiding duplicate world variants. Old positional matrix aliases
  have been removed.
  It selects an existing real build sibling when `cpto` is available and uses
  the source tree when the sibling resolves to source, is absent, or `cpto` is
  unavailable. It never synchronizes the trees automatically.
- Verified the optional Android arm64 `worldd` artifact embeds
  `CGO_ENABLED=0` and runs its CLI. This proves the CGO-free build path only;
  using the ZeroTier app's host-managed network still needs a live peer check.
- Replaced proposal-inbox hard-link publication with same-directory atomic
  rename after Termux denied hard links. The permission test now sets its mode
  explicitly despite Termux's restrictive umask. Upgraded go-libp2p to 0.46.0
  (quic-go 0.57.1) to fix the Go 1.26+ QUIC session-ticket panic. The full
  worldd Go suite passes on Termux with `-checklinkname=0`; its desktop Chromium
  integration is skipped on Android and remains a Linux check.

- Clarified the invitation-entry contract: start at the world's authored pose;
  relocate only for a player or colliding object, choose the nearest free
  location within the world's maximum displacement, and reject entry if the
  bounded area is full. Portal arrivals continue using their mapped pose.
- The runtime still places entrants directly at the authored pose. The world
  format's displacement field/default and behavior when owner presence is
  unavailable remain design decisions before implementation.

## 2026-10-24

- Hosted invites no longer construct the built-in Example Island fishing game.
  That constructor loaded the local `GameState` and created hidden vendors and
  fishing objects even though hosted frames never update them. The built-in
  game remains enabled for unlinked Example Island launches; portable fishing
  gameplay is still open.
- Every authored world now requires an explicit visitor cap and horizontal
  invitation spawn radius. Tidewater is set to 128 visitors and 8 m. Invitation
  admission uses nearest-first collision-free candidates and owner-side atomic
  occupancy/capacity checks; portal arrivals keep their mapped pose and are
  checked against destination capacity.
- Moved the stable reef-placement type/variant registry into a renderer-free
  module. The network codec no longer imports the reef engine, GPU batches,
  materials, or fish simulation; the Reef renderer checks its definitions
  against that registry. Deterministic placement and standalone codec checks
  pass. The adapter built on this renderer-free contract is recorded below.
- Bumped the authoring and signed runtime document protocols to `/2` because
  their required structure changed. World data itself is not versioned by the
  engine protocol. Tidewater's source submodule and the package exporters now
  emit the new format and explicit rules.
- Focused spawn, presence-session, source-manifest, portal, proposal, directory,
  resolver, and syntax checks passed. The complete worldd Go suite passed with
  `go test -ldflags='-checklinkname=0' ./... -count=1`; secure WSS gateway/cache
  and browser-host worker end-to-end tests passed. The live WSS path verifies
  two distinct nearest-first spawn positions and rejects a third visitor at
  the signed cap. Go-backed Node tests now add the Android linker flag
  automatically; without it, Go 1.27.3 rejects anet's `net.zoneCache` linkname
  before tests run. Full `worldd` regression tests now cover the same admission
  behavior over authenticated peer forwarding, WebTransport, WebSocket, and
  WebRTC data channels. The normative network design and protocol docs now
  match the required version-2 world rules, fail-closed admission, and client
  collision-candidate trust boundary; invitation-token service work stays open.
  `adb devices -l` lists no attached phone, so Flip7 visual
  verification remains open.

- Split wildlife state progression from its WebGPU presentation wrapper. The
  new `WildlifeSimulation` owns bird, shorebird, crab, viewer, and water-query
  state and accepts environment samples explicitly; the WebGPU `Wildlife`
  adapter now owns batches, shadows, and the optional GPU swash probe. A
  renderer-free simulation test advances the same systems and checks their
  emitted poses. WebGL now constructs that runtime for the built-in island and
  hosted wildlife packages, and renders the shared bird and shorebird poses
  through a Three.js adapter using shared species rest shapes and
  `WildlifeFrame` visibility/fading. The adapter currently uses simplified
  species colors. Crab and burrow records now come from the shared
  `CrabPresentation` and render through WebGL instanced batches. The WebGL
  built-in WebGL island now evaluates shorebird swash from the same shoreline
  field and shared swash math as WebGPU. Detailed materials, contact shadows,
  and matched visual parity remain open; hosted wildlife presentation is
  supported while remote animal authority remains open. Dawn Node based checks
  are skipped only by the Android test runner; browser-compatible test
  migration is low priority.

- Hosted WebGL now replaces a signed boat berth preview with the shared
  interactive boat model and controller. The renderer uses the signed berth
  position and heading, hosted colliders, and WebGL water-query path; rendered
  handling and visual parity still need a live browser review.

- Rebuilt the optional Android arm64 `worldd` from source revision `5ca7b8b`.
  Go build metadata reports `CGO_ENABLED=0`, and `worldd --version` reports the
  same full source revision. This verifies the CGO-free build and CLI, not a
  live connection through a host-managed ZeroTier service.
- The grass-density codec, source-to-manifest, and content-submodule checks
  passed; the mounted Tidewater package contains 60 verified assets. The
  Android test runner now skips the five Node Dawn-dependent checks only on
  Android because this Termux Node installation lacks
  `webgpu/dist/android-arm64/dawn.node`; those checks remain enabled elsewhere.
  Migration to the Android headless-browser path is a low-priority follow-up.
- Added `worlds/tidewater/test/vegetation-parity.mjs` to regenerate built-in vegetation from
  Tidewater's source terrain and village. The seeded plant-placement asset
  matches byte for byte, and all channels of the 1024×1024 grass mask match
  exactly. Visual density distribution and LOD behavior still need matched-view
  review.
- Added `test/elsemesh-lod-package.mjs`: all 143 non-terrain object instances
  have a valid, geometry-reducing distance level, covering six shared asset
  pairs. The only objects without LODs are the full and portal-preview terrain
  representations. This CPU package check does not establish rendered LOD
  transitions or visual parity.
- A multi-view Flip7 review started on Rebroad scrcpy's display-only virtual
  display (logical display 25; SurfaceFlinger ID `11529215049311824793`).
  Chrome was launched and captured only on that display. The ADB transport
  disconnected before a matched hosted/built-in review could be completed, so
  density/LOD parity and desktop visual acceptance remain open.
- WebGL fallback is included in the parity acceptance target. Its hosted path
  previously loaded base object assets and water only. The hosted loader now
  uses the shared `WorldObjectLOD` controller and queue to fetch and render
  authored variants using the same projected-size thresholds, hysteresis, and
  transition timing as WebGPU. Matched rendered parity remains open; the
  implemented hosted features and outstanding component gaps are listed below.
- Static reef placements now render through WebGL in both the built-in island
  and hosted worlds. The adapter uses canonical Reef geometry and authored
  distance-LOD thresholds, with frustum/range culling and hard/soft instance
  batches. It now shares placement seed/flex data and the analytic swell
  direction and periods for soft-organism bending and massive-colony warping.
  FFT swell contribution, deformed normals, procedural Reef materials, shadows,
  fish simulation, reef collision, and matched visual parity remain open.
- Hosted WebGL now decodes the verified terrain heightfield and static
  vegetation placement and grass-density assets with the shared package
  codecs. Its existing Three.js plant builders consume the packaged placements;
  camera-following grass samples all four authored mask channels and uses the
  packaged terrain heights. This removes the hardcoded Example Island grass
  scatter from hosted worlds and initializes grass streaming state so hosted
  frames do not fail on an unset center. Geometry, draw distance, and visual
  density still need matched-render review. Hosted fish props now decode the
  signed placement asset and share the canonical procedural geometry selector
  and CPU mirror for jaw/curl/sag deformation with the primary renderer. WebGL
  still approximates fish shading; species markings and shader-level surface
  effects need a shared/backend-specific parity implementation and matched-
  render review. Reef WebGL now consumes the signed placement seed/flex fields
  and shares the primary renderer's analytic swell direction and periods for
  soft-organism bending plus massive-colony warping. FFT swell contribution,
  deformed normals, procedural Reef materials, and shadows remain open. The
  packaged Whale now reuses the shared simulation, CPU rig pose, signed route,
  asset LODs, and height/albedo/roughness data in the WebGL fallback. Its
  standard Three.js lighting, whale shadows and spray effects, and matched
  visual parity remain open. Village material profiles and other declared
  behaviors remain open in WebGL.
- Hosted WebGL now routes signed ambient-audio beds through the existing shared
  `SoundScape` world-audio service, including spatial position, authored
  conditions, listener state, and the same sun-based day/night calculation as
  the primary renderer. Audio components whose verified bed assets are outside
  the initial visible preload remain deferred/unsupported in fallback mode.
