# Graphics and content boundary

## Objective

The selected graphics backend must not decide which ElseMesh world, gameplay,
or simulation systems exist. WebGPU and WebGL must consume the same world and
game state. Backend-specific code owns GPU resources, materials, render passes,
and visual approximations where an effect cannot be shared; it must not own a
second copy of game content or gameplay rules.

## Current failure

`App.init()` returns to `WebGLFallback` immediately after backend selection.
That fallback still constructs a separate Three.js scene and independently
loads a reduced terrain, village, vegetation, and water presentation. It now
adapts the canonical boat model and bird simulations, but the fish game,
vendors, crabs, whale, and richer ocean systems remain on the ordinary App
path. Some of those classes also mix simulation with render-object
construction, so removing the return alone would not establish backend
independence.

## Target ownership

- **World and game content** own stable identities, placements, geometry or
  asset references, interaction/collision data, and mutable gameplay state.
  They do not import a renderer, graphics-engine scene node, GPU resource, or
  backend shader.
- **Simulation** owns deterministic state transitions and consumes backend
  neutral inputs such as terrain queries and water samples. It publishes state
  for presentation; it does not create or update render objects.
- **Presentation adapters** consume the same content and simulation state.
  WebGPU and WebGL adapters may own different meshes, materials, shaders,
  particles, lighting, and post effects, but cannot omit or redefine an entity
  or gameplay behavior.
- **Application orchestration** constructs the shared world/game runtime once,
  selects a presentation adapter, and sends the same updates to shared
  simulation regardless of backend.

Content descriptors should be ordinary data and stable across backend changes.
Presentation objects should be disposable and rebuildable from those
descriptors plus current simulation state.

## Current progress, 2026-10-11

`WebGLBoatAdapter` copies the canonical `BoatModel` meshes into Three.js and
uses the same `BoatController` state. It currently has no WebGL water-query
adapter, so the boat remains at its shared mooring state. `WebGLWildlifeAdapter`
constructs the same `Birds` and `Shorebirds` simulations as WebGPU and presents
their states with Three.js instanced meshes and simplified materials/poses.
Crabs and the shore probe are not yet connected. These adapters do not remove
the early return or the separately loaded WebGL island scene.

## Migration order

1. Introduce a backend-neutral world runtime and explicit content/state
   contracts. Move orchestration out of the backend-specific early-return path
   without making WebGPU-only systems run against WebGL accidentally.
2. Split mixed domain/presentation classes at their ownership boundary. Start
   with boat hydrostatics/controller state and wildlife behavior, then static
   village, fish stand, chandlery, and vendor content. Preserve existing
   geometry, assets, placements, interactions, and collision behavior as the
   shared source of truth.
3. Give each renderer an adapter for those shared entities and state. Keep
   GPU-only ocean simulations and post effects behind effect adapters, with
   shared parameters and a defined WebGL implementation or documented visual
   approximation.
4. Switch WebGL to the same runtime and content source. Delete the fallback's
   duplicate island/content construction once parity is covered; retain only
   WebGL presentation code.
5. Verify shared content and behavior under both backends, then compare matched
   camera, viewport, time, render scale, and graphics settings for visual
   quality and frame rate.

## Acceptance criteria

- Backend selection does not skip creation of the boat, fish stand, vendors,
  wildlife, gameplay, or shared world state.
- Both adapters render the same entity IDs, placements, assets, and dynamic
  state for the boat, fish stand, wildlife, village, and ocean-facing content.
- Gameplay and simulation tests run without constructing a graphics backend.
- No WebGL-only copy of world/game content or behavior remains in
  `WebGLFallback`.
- Matched runtime captures show the required content and ocean effects on both
  backends, and report frame rate and material visual differences explicitly.
