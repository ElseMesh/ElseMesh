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
  backend shader. World packages contain authored data and renderer-neutral
  simulation only; they do not contain production presentation adapters.
- **Simulation** owns deterministic state transitions and consumes backend
  neutral inputs such as terrain queries and water samples. It publishes state
  for presentation; it does not create or update render objects.
- **ElseMesh presentation** owns backend selection, scene objects, GPU
  resources, WebGPU/WebGL adapters, shaders, particles, lighting, and post
  effects. Both adapters consume the same renderer-neutral content and
  simulation state; they cannot omit or redefine an entity or gameplay
  behavior. World packages may register component schemas, decoders, and
  renderer-neutral simulation factories, but may not register backend
  presenters or material compilers.
- **Application orchestration** constructs the shared world/game runtime once,
  selects a presentation adapter, and sends the same updates to shared
  simulation regardless of backend.

Content descriptors should be ordinary data and stable across backend changes.
Presentation objects should be disposable and rebuildable from those
descriptors plus current simulation state.

## Migration rule

This ownership is a fixed architecture decision, not a per-feature choice.
Do not move a WebGPU implementation into a world and later add a WebGL copy
there, or move only one backend back into ElseMesh. A world feature is migrated
as one unit: define its renderer-neutral authored data and simulation contract,
implement both backend presenters in ElseMesh, switch the world package to
that contract, and remove its backend-specific presentation code in the same
migration. Extend the engine's bounded material/effect contract when existing
appearance cannot be expressed; do not preserve raw world shaders as an
escape hatch. Keep a feature on the old path until the complete migration can
be reviewed and verified, rather than creating another backend-specific port.

The migration is complete for a feature only when its production world package
has no renderer imports, backend adapter registration, WGSL/GLSL, or GPU
resource creation, and both engine backends consume the same signed content
and simulation outputs. A test fixture may exercise backend code, but should
live beside the engine implementation unless it specifically validates
renderer-neutral authored data.

## Renderer-neutral material contract

World packages describe materials and effects as data. They must not ship or
register a WebGPU or WebGL implementation. ElseMesh owns backend selection,
resource creation, and compilation of those descriptions to WGSL or the WebGL
shader path. A world may define domain-specific roles and parameters, but the
role identifies authored intent; it does not select a renderer adapter.

The portable baseline is glTF PBR material data and textures. Features beyond
that baseline must use a versioned, bounded material/effect description whose
operations and inputs are defined independently of either graphics API. Each
operation supported by the engine must have WebGPU and WebGL implementations
with a shared conformance fixture. The engine may report a feature unsupported
when a backend cannot implement it; worlds must not silently substitute a
backend-specific shader. Raw WGSL and GLSL are not a portable contract and
cannot be translated reliably in general.

This is the fixed ownership boundary for material work: do not move shader
code between a world and ElseMesh as a backend-by-backend port. Extend the
renderer-neutral description and both engine compilers together, or represent
the appearance with portable assets. The unused Tidewater-specific fish
sidecar profile has been removed; its unconnected geometry sidecar now uses
ordinary glTF PBR and remains outside the signed runtime package. That sidecar
does not establish fish appearance parity.

The Example Island village now carries all material maps in its signed GLBs and
describes the full wood, glass, hard-surface, net, thatch, fabric, stone, and
roof-metal appearance with `elsemesh.material-graph/1`. Tidewater no longer
registers a village material profile, package material adapter, or WebGL
material component adapter. ElseMesh compiles the same graph data for WebGPU
and WebGL. This removes the world-owned village shader and profile-resolution
paths; the built-in procedural village still generates its portable source maps
through Tidewater's WebGPU texture baker and remains migration debt.

Do not move a world's bespoke shader or material implementation into ElseMesh
verbatim just to remove renderer APIs from the world. First choose a portable
representation: bake world-specific appearance into ordinary glTF/PBR assets
during world export, or express it in a material/effect contract that is useful
across worlds. Only the contract and its WebGPU/WebGL compilers belong in the
engine. The world keeps the authored textures, parameters, and other content
inputs; it does not register either backend implementation. If neither portable
representation can preserve the required appearance, treat the feature as an
unresolved migration instead of relocating its custom shader into the engine.

Before moving a feature, write down its renderer-neutral inputs and outputs and
check that both engine backends consume the same contract. Then migrate the
complete feature once, including asset decoding, both presenters, and removal
of world-side backend registrations. This avoids making the world renderer
aware to compensate for an incomplete engine path, or making the engine
world-specific to compensate for a non-portable world implementation.

## Renderer-free reef placement contract

The stable type order, model-variant counts, and codec for
`elsemesh.reef-placement/1` live in `worlds/tidewater/ReefPlacementTypes.js`
and `worlds/tidewater/ReefPlacements.js`. The Tidewater provider registers the
asset decoder; `Reef.js` validates decoded names and variants against its own
renderer catalog without importing the Tidewater wire table. The WebGL
fallback presents signed static placements in built-in and hosted worlds
through the canonical geometry and distance-LOD catalog. Its materials and
LOD transitions are simplified; flex animation, shadows, fish, reef collision,
and matched visual parity remain open.

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
backend. `worlds/tidewater/test/boat-design.mjs` exercises that Tidewater
design contract; the full suite and production build remain required after
later changes.

This completes only the boat's first ownership split. The WebGL fallback still
builds a separate reduced world, but its hosted boat adapter now converts the
canonical model into Three.js, replaces a signed berth preview, and connects
the shared controller to the WebGL player and water query. Wildlife now has a
shared simulation and registered backend presentations; village props, vendors,
and other backend-specific effects still need shared content/runtime adapters.
Matched Flip7 views and comparisons under both graphics backends remain open.

## Wildlife package ownership milestone (partial)

The Tidewater wildlife simulation, species data, and WebGPU presentation now
live under `worlds/tidewater/wildlife`. Bird and shorebird behavior consume
explicit environment samples, while crab behavior is separated from
`CrabPresentation`, which creates renderer-facing records. `WildlifeSimulation`
owns bird, shorebird, crab, viewer, and water-query state without constructing
meshes or GPU resources. The WebGPU `Wildlife` adapter owns the instance
batches, contact shadows, and optional GPU swash probe. Tidewater registers its
WebGL presentation adapter through the component backend registry; it consumes
the same simulation, bird and shorebird poses, species rest shapes, frame
visibility policy, and crab presentation records. The WebGL island evaluates
shorebird swash from the same shoreline field and shared math as WebGPU. The
plain `IslandDefinition` data now lives in the Tidewater repository, but these
modules still import engine rendering/math APIs and the world layout directly,
so the package is not yet fully independent of engine internals. The WebGL
fallback also lacks the WebGPU species materials and contact shadows, and
hosted animal authority remains unimplemented. This is package ownership and
runtime reuse, not cross-backend wildlife parity.

The wildlife unit and renderer tests now live under
`worlds/tidewater/test`; small root test entry points preserve the existing
ElseMesh test commands. `wildlife-runtime.mjs` advances the simulation without
a renderer; `webgl-wildlife-adapter.mjs` checks shared rest shapes and pose
consumption; and `life-wildlife.mjs` is the headless rendered smoke for WebGPU
birds, ghost crabs, and hermit crabs.
The Android test runner skips only the five Node Dawn-dependent checks on
Android; the remaining client suite passes there. Do not claim cross-backend or
Flip7 parity until both wildlife adapters, matched device views, and the
remaining effects are verified.

## Fish stand extraction milestone (partial)

The fish stand's identity, placement, vendor interaction descriptor, collision
volumes, material pattern IDs, and procedural fallback geometry now live in
backend-neutral content modules. `WebGLFishStandAdapter` consumes the same
authored placement and collision descriptors as the WebGPU game and loads Joe's
shared character asset. `WebGLGameAdapter` uses Tidewater's
`FishingGameRuntime`, `GameState`, and `Gear`, plus the shared browser
`FishingRod` and `GameHUD`; Tidewater supplies its `BoatGameplayRuntime`.
Together, these pieces support casting, bite/fight transitions, selling,
upgrades, fuel, sonar, the catch card, and matching fishing-event cues. The
signed Tidewater JavaScript Worker owns bite, fight, and boat simulation; both
renderers send it bounded environment samples and present the returned state.
Focused headless checks cover these paths. Remaining
parity work includes live matched-browser gameplay, scanned StallKit surface
materials, and broader visual comparison. The backend-specific early return
and separate island scene remain in place.

The world behavior registry now owns browser fishing activation, hosted-world
teardown, and per-frame updates. WebGL key handling, gameplay input blocking,
and fishing updates also dispatch through registered hooks, so the fallback no
longer calls its fishing adapter directly from the frame and input loops.
The fishing guide and minimap also read the resolved vendor positions from the
active behavior runtime instead of the built-in island coordinates.

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
