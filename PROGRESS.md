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
