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

Remaining gates: explicit bootstrap/readiness metadata, a minimum-pipeline
entry pass, spatial chunking for monolithic assets, and a rendered remote-world
test proving that background content continues loading after entry.
