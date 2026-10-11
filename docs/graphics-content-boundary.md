# Graphics and content boundary

## Objective

The selected graphics backend must not decide which ElseMesh world, gameplay,
or simulation systems exist. WebGPU and WebGL must consume the same world and
game state. Backend-specific code owns GPU resources, materials, render passes,
and visual approximations where an effect cannot be shared; it must not own a
second copy of game content or gameplay rules.

## Current failure

`App.init()` returns to `WebGLFallback` immediately after backend selection.
That fallback constructs a separate Three.js scene and independently loads a
reduced terrain, village, vegetation, and water presentation. The ordinary App
path constructs the boat, game, vendors, wildlife, whale, and the richer ocean
systems after that return. Some of those classes also mix simulation with
render-object construction, so removing the return alone would not establish
backend independence.

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

## Migration order

1. Introduce a backend-neutral world runtime and explicit content/state
   contracts. Move orchestration out of the backend-specific early-return path
   without making WebGPU-only systems run against WebGL accidentally.
2. Split mixed domain/presentation classes at their ownership boundary. The
   first split is complete for the lobster boat; wildlife has a partial
   extraction; continue with its remaining renderer orchestration, then static
   village, fish stand, chandlery, and vendor content.
   Preserve existing geometry, assets, placements, interactions, and collision
   behavior as the shared source of truth.
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

## First completed split: lobster boat

`BoatDesign` and `BoatSpecs` now own the renderer-neutral hull dimensions,
hydrostatic values, interaction points, collision shapes, and equipment
placements. `BoatController` consumes that design and owns the live physical
state. `BoatModel` builds the existing Three.js presentation and copies the
controller state through `sync()`; the hosted-boat adapter does the same. The
player and controller import the CPU math package directly, and the boat berth
layout no longer imports the full engine entry point.

The procedural boat geometry, materials, equipment, and existing game
behavior remain the presentation reference. The simulation can now be
constructed from a `BoatDesign` without constructing a `BoatModel` or a GPU
backend. `test/boat-design.mjs` exercises that path; the full suite and
production build remain required after later changes.

This completes only the boat's first ownership split. The WebGL fallback still
builds a separate reduced world, and wildlife, village props, vendors, and
backend-specific rendering effects still need shared content/runtime adapters.
Matched Flip7 views of the refactored boat and comparisons under both graphics
backends remain open.

## Wildlife extraction milestone (partial)

The island constants now live in plain data in `IslandDefinition`; renderer
math and wildlife-specific math/species data have separate modules. Bird and
shorebird behavior consume explicit environment samples, while crab behavior
is separated from `CrabPresentation`, which creates renderer-facing records.
The active `Wildlife` orchestrator still writes directly to the existing bird,
critter, and shadow batches, and some bird pose/interpolation state remains
presentation-specific. This is an ownership split in progress, not a shared
WebGPU/WebGL wildlife adapter yet.

The full `npm test` suite, production build, focused hermit-crab update test,
and WebGL boat-adapter test pass. A headless rendered wildlife smoke produced
bird, ghost-crab, and hermit-crab frames. The Flip7 is not currently connected
to ADB, so this wildlife change has not received a new on-device visual check.
Do not claim cross-backend or Flip7 parity until the remaining adapters and
matched device views are verified.

## Fish stand extraction milestone (partial)

The fish stand's identity, placement, vendor interaction descriptor, collision
volumes, material pattern IDs, and procedural fallback geometry now live in
backend-neutral content modules. `WebGLFishStandAdapter` consumes the same
placement, collision descriptors, and generated geometry as the WebGPU-side
stand fallback, and loads Joe's shared character asset. `WebGLGameAdapter`
connects the fallback buyer to the existing `GameState` and `GameHUD`, restores
the same browser-saved inventory, and routes selling through the shared game
rules. The headless fish-stand and game-adapter checks pass. The WebGL path
does not yet implement the rod/casting/bite/fight simulation, render the static
fish display, or use the photo-scanned StallKit surface textures. This buyer
integration is partial gameplay parity, not a complete game runtime. The
backend-specific early return and separate island scene remain in place.

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
