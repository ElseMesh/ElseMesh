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
- Portable hosted grass, desktop comparison, fishing and wildlife authority,
  broader gameplay parity, and sustained performance acceptance remain open.

- Clarified the invitation-entry contract: start at the world's authored pose;
  relocate only for a player or colliding object, choose the nearest free
  location within the world's maximum displacement, and reject entry if the
  bounded area is full. Portal arrivals continue using their mapped pose.
- The runtime still places entrants directly at the authored pose. The world
  format's displacement field/default and behavior when owner presence is
  unavailable remain design decisions before implementation.
