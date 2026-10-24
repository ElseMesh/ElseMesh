# ElseMesh progress

This is the dated implementation and verification log. Current priorities and
open product requirements are tracked in [PROJECT-DIRECTION.md](PROJECT-DIRECTION.md);
completed milestones are summarized in [GOAL-done.md](GOAL-done.md).

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

- Rebuilt the optional Android arm64 `worldd` from source revision `5ca7b8b`.
  Go build metadata reports `CGO_ENABLED=0`, and `worldd --version` reports the
  same full source revision. This verifies the CGO-free build and CLI, not a
  live connection through a host-managed ZeroTier service.
- The grass-density codec, source-to-manifest, and content-submodule checks
  passed; the mounted Tidewater package contains 60 verified assets. The full
  `test/world-export.mjs` check could not reach its assertions because this
  Termux Node installation lacks `webgpu/dist/android-arm64/dawn.node`.
- Added `test/grass-density-parity.mjs` to regenerate built-in vegetation from
  Tidewater's source terrain and village. The seeded plant-placement asset
  matches byte for byte, and all channels of the 1024×1024 grass mask match
  exactly. Visual density distribution and LOD behavior still need matched-view
  review.
- Added `test/tidewater-lod-package.mjs`: all 143 non-terrain object instances
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
  transition timing as WebGPU. The remaining declared Tidewater components are
  still omitted by WebGL; matched rendered parity remains open.
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
  render review. Reef, wildlife, whale, boat component behavior, village
  material profiles, and other declared behaviors remain open in WebGL.
- Hosted WebGL now routes signed ambient-audio beds through the existing shared
  `SoundScape` world-audio service, including spatial position, authored
  conditions, listener state, and the same sun-based day/night calculation as
  the primary renderer. Audio components whose verified bed assets are outside
  the initial visible preload remain deferred/unsupported in fallback mode.
