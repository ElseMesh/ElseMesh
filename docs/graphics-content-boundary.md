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
  behavior. Built-in and hosted routes must use the same authored object and
  texture inputs; a built-in fallback may not silently omit or regenerate
  objects represented by the world source. World packages may register
  component schemas, decoders, and renderer-neutral simulation factories, but
  may not register backend presenters or material compilers.
- **Application orchestration** constructs the shared world/game runtime once,
  selects a presentation adapter, and sends the same updates to shared
  simulation regardless of backend.

Content descriptors should be ordinary data and stable across backend changes.
Presentation objects should be disposable and rebuildable from those
descriptors plus current simulation state.

## Performance controls and content identity

ElseMesh may expose an adjustable minimum-FPS target and quality controls. Its
adaptive policy may reduce render scale or shadow/reflection cost, change mip
selection or texture residency, and select among the world's authored LOD
assets. These are rendering-cost adjustments, not backend-specific content
variants: WebGPU and WebGL retain the same authored objects, placements,
geometry, texture sources, variants, and material inputs. Both follow the same
visibility and LOD policy and select the same authored LOD assets at matched
view and quality settings. Their live quality levels may differ when measured
frame rates differ, which can select different levels from those shared authored
asset families. A backend may use its own GPU implementation, but it must not
meet an FPS target by dropping object classes or substituting another content
or texture set.

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

This is also the rule for classifying existing code: a presenter under
`worlds/<world>/renderers/`, or a world package registering WebGPU/WebGL
adapters, is migration debt rather than the target boundary. Moving such code
between repositories does not advance renderer separation. Do not move it back
to ElseMesh as a location-only correction either. Leave the current path intact
until the complete feature contract, both ElseMesh presenters, and parity gate
can be delivered together; then replace the world-owned presenters in that one
migration. New world features must enter through renderer-neutral data and
simulation contracts from the outset.

`docs/renderer-boundary-debt.json` and
`test/world-renderer-boundary-debt.mjs` track the current Tidewater exception
set and fail when a new production world module introduces or transitively
depends on a renderer import, backend adapter registration, or renderer module.
Remove entries as complete feature migrations land; do not add entries to
normalize a new backend-specific world implementation.

The engine registry is keyed by renderer-neutral component/material/effect
contracts. Backend selection and the WebGPU/WebGL implementations for those
contracts remain registered and owned by ElseMesh. A world may register its
schema, decoder, authored assets, and simulation factory, but it must not
register a backend presenter. If a feature needs richer appearance than glTF
PBR can express, extend a bounded data contract and both engine compilers, or
bake that appearance into portable assets. General translation of arbitrary
WGSL/GLSL is not a viable boundary: shader source is backend-specific and
cannot be reliably converted between APIs.

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

The Tidewater exporter now includes scanned debris in the signed world source
as one renderer-neutral static-model component. Its descriptor carries all 141
placements, four model classes, and three source mesh LODs per model. Those GLBs
reference the unchanged albedo, normal, and ARM source maps as shared
content-addressed image assets instead of embedding duplicate map bytes in
each LOD. Their signed material graph describes wood bleaching, wet darkening
and roughness, and contact dust/AO with data-only operations understood by
both engine graph compilers. The graph contract queries the installed authored
terrain heightfield per fragment, removing the former center-sampled
contact-height approximation. The shared static-model planner applies
Tidewater's six-times-radius distance metric to LOD and color draw range/fade
in both backends. Both renderers select shadow batches from the same LOD family,
thresholds, and transition fades, with a shared optional coarser shadow bias;
shadow distance is independently bounded. The native WebGPU bootstrap's
legacy scanned-debris presenter also enables shadow casting on every LOD batch,
so its color-selected LOD supplies the shadow. These legacy procedural
presenters remain migration debt and do not yet consume the signed static-model
component used by hosted package worlds. The offset metric uses a centered
smoothstep band matching Tidewater's authored fade math; rendered fade parity
remains unverified. Matched backend images are still required to verify contact
shading, LOD fades, and overall appearance.

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

## Vegetation migration gate

Tidewater's finite vegetation path remains world-owned presentation code:
`worlds/tidewater/component-installers.js` constructs
`renderers/WebGPUVegetation.js`, `register-components.js` loads
`renderers/WebGLVegetationComponentAdapter.js`, and the built-in `App` path calls
the world's `presentation.createVegetation` factory. These presenters still
implement different LOD and wind behavior. Their location in the Tidewater
repository does not satisfy renderer neutrality, and moving either presenter
alone would repeat the backend-by-backend migration that this document forbids.
The shared procedural plant geometry builders now live in
`worlds/tidewater/vegetation/geometry/` and are consumed by both presenters and
the world exporter. They still return engine `BufferGeometry`; this clarifies
authorship but does not yet provide the portable signed model/LOD inputs needed
to remove the presenters from Tidewater.

The matched AMD beach captures show a substantial distant-canopy mismatch.
`WebGLVegetationPresentation.js` draws trees beyond 110 m from an instanced
5-sided cylinder plus 5-by-3 sphere lobes (`TREE_LOBES`), whereas
`WebGPUVegetation.js` uses view-dependent octahedral impostors baked from
`buildTreeNear()`/`buildShrubNear()` geometry and the shared WebGPU leaf atlas.
These paths consume the same placement records but not the same distant model,
texture inputs, or presentation behavior. The fix must define a signed,
renderer-neutral canopy LOD asset/data contract and have both engine backends
consume the same authored near and far content. Preserve both current paths
until that contract passes matched pre-split WebGPU and WebGL reviews; do not
replace the WebGL primitives with another Tidewater-owned presenter.

The current source bake provides a concrete portable target: 3 tree and 2 shrub
variants, each rendered from a 6-by-6 upper-hemisphere direction grid with
128-pixel frames. Its two RGBA atlases carry coverage/leaf brightness/class
data and local normal/exposure data. The new contract should package those
shared atlas bytes once, with authored bounds, variant mapping, near/far
handoff, palette inputs, and per-instance seed/yaw/scale. ElseMesh should own
the billboard orientation, octahedral frame lookup/reprojection, wind offset,
LOD fade, and WebGPU/WebGL texture binding through registered adapters. This
view-dependent lookup is beyond the current static GLB material graph, so it
needs one explicit engine component contract rather than separate WGSL and
GLSL implementations in Tidewater. Both backends must sample the same signed
atlas assets and select the same LOD at matched quality settings.

`src/network/OctahedralCanopyAssets.js` loads the signed descriptor, validates
the instance-set and PNG references against the component and manifest, checks
atlas dimensions and data-image encoding, and exposes near GLBs through a lazy
signed-asset loader. Startup requests only the descriptor; adapters fetch the
instance set and atlas data as they initialize. The PNG decoder disables color
conversion and alpha premultiplication. Tidewater's exporter now emits the
source WebGPU material and normal/exposure atlases as deterministic,
content-addressed raw-data PNG sidecars. It now also emits an inactive near-
model sidecar containing all tree/shrub lobe variants, the authored placement
transforms, and the same seed-based variant selection. The GLBs preserve all
three source VEC4 streams but still use a provisional PBR material. The
exporter now also writes the source leaf-mask atlas as a content-addressed,
linear RGBA8 data PNG and records its 2×2 tile layout and channel meanings.
The signed material graph and runtime references are still missing. Neither
sidecar is referenced by the signed world package, and no backend adapter
consumes them. The Tidewater export test reruns the bakes and checks byte
identity, dimensions, asset hashes, source streams, placement counts, and
variant selection. Do not activate the geometry until the complete signed
appearance contract and both engine adapters pass matched review.

`elsemesh.octahedral-canopy/1` now declares those two atlas assets as PNG data
with `rgba8unorm-data/1` semantics. PNG decoding must preserve raw linear byte
values; color-space conversion and alpha premultiplication are not allowed.
Its signed descriptor also carries an `elsemesh.material-graph/1` graph for
canopy surface appearance. The graph requires `baseColor` and can describe
roughness, translucency, and wind-driven vertex position through the bounded
contract compiled for both backends; it contains no backend shader source.
The descriptor now validates a renderer-neutral appearance block for color,
lighting, and wind coefficients. Its required `leafMask` record references a
third signed raw-data PNG and defines the row-major tile layout and channel
meanings. `OctahedralCanopyAssets` loads it through the signed component asset
inventory and verifies the decoded image dimensions against that layout.
Tidewater's exporter now assembles the near instance set, near GLBs, both frame
atlases, leaf mask, appearance inputs, and LOD rules into an inactive
`vegetation-canopy-runtime-package.json`. The engine descriptor and asset loader
validate against the actual content-addressed source files. This candidate is
still outside `world-source.json`; its near-model graph remains provisional and
neither backend adapter consumes the component.
The material atlas channels are R brightness, G leaf flag, B per-card color
variation, and A coverage. The normal/exposure atlas stores the three
0.5-encoded local normal components in RGB and ambient exposure in A. The
engine must generate sampling mips from these data values without an sRGB
transform. This corrects the earlier KTX2-only assumption: no KTX2 encoder is
currently available in the Tidewater export pipeline. The descriptor now
records the source tree handoff at 65 m, shrub handoff at 45 m, tree fade from
2,600 to 2,800 m, and shrub hard cutoff at 180 m. It also specifies the 100 m
three-frame blend limit, shared 12% LOD transition band, and 50% thinning from
140 to 320 m, selected with the source seed multiplier 91.7 and compensated
with inverse-square-root retained density. The complete canopy palette, wind
response, signed atlas references, and production adapters are still missing;
those remain required before replacing either presenter.

`src/engine/render/OctahedralCanopyRuntime.js` now resolves each instance to its
authored group, quaternion yaw, seed-selected atlas variant, and shared near/far
weights. Its camera plan also applies group cutoffs, tree fade, deterministic
thinning, and crown-growth compensation. Tidewater's palette, species
selection, variant selection, handoff distances, thinning, atlas dimensions,
shading inputs, and impostor wind coefficients now live in the plain-data
`vegetation/CanopyProfile.js`; the current WebGPU shader and atlas exporter
consume that same profile. Its color, lighting, and wind subset is projected
as `elsemesh.canopy-appearance/1`, validated by the engine descriptor codec,
and checked in the deterministic export and descriptor tests. The exported
descriptor sidecar still is not signed world content, neither engine backend
consumes the component contract, and both world-owned presenters remain active.
No appearance-parity gate has closed.

Use the common asset-index convention for this contract: LOD0 is the highest-
detail near model, and increasing indices are progressively coarser. The
runtime can preserve coarse-first streaming by requesting the last index first;
streaming order does not change the authored LOD numbering.

Dense ground cover now uses the engine-owned `elsemesh.ground-cover-field/1`
runtime in both built-in and hosted paths. The former Tidewater-specific
`webglGrassMesh()` approximation has been removed from
`src/fallback/WebGLFallback.js`; the WebGL and WebGPU component adapters both
consume the same signed density field, patch GLBs, placement records, material
graph, cell selection, and LOD batches. This establishes a shared content path,
but does not yet prove matched appearance against pre-split WebGPU.

Keep Tidewater-owned scatter rules, placement records, density maps, species
parameters, and authored model assets in Tidewater. Move all production
geometry presentation, wind evaluation, grass patch generation, draw scheduling,
and GPU resource creation to ElseMesh. The `elsemesh.ground-cover-field/1`
contract now describes signed density/model assets, per-species parameters,
deterministic placement, LOD, wind, and shadow intent. Its bounded density
expressions let a world describe population blends over RGBA channels without
assigning Tidewater meanings to those channels. `GroundCoverFieldRuntime` owns
camera-centered candidate generation; `GroundCoverFieldDrawPlanner` owns
shared visibility, LOD, transition, draw-fade, and shadow selection; and
`GroundCoverFieldBatchRuntime` packs those selections into shared transform,
fade, and shadow batches for backend upload. The
contract now has a `fixed-cell-patch/1` placement mode for signed GLBs that
already contain each cell's complete authored layout. It emits one identity
instance at each occupied cell origin and uses the shared distance-band choice
for both adapters; minimum-FPS bias may choose a coarser asset from the same
signed LOD list. Tidewater exports and activates its near/mid/far patch GLBs
with the authored ground-cover graph. The paired fixture loads those exact GLBs
through both adapters and exercises their material graph and geometry using a
synthetic density mask, shared terrain-detail texels, and flat terrain. A
separate signed-asset WebGPU comparison uses Tidewater's committed density and
terrain assets at the same 55-degree ground-level meadow camera as the WebGL
fixture. The graph render is 6.653/255 RGB mean absolute error from the test-only
pre-migration `GrassField`. Shared cell-height padding makes its selected cell
coordinates identical to the source's 51 cells and its near/mid/far counts
identical at 9/23/19. The signed-content WebGL browser fixture also renders
without GL errors. Matched production views against pre-split WebGPU remain
open.

The ground-cover material graph can read the installed terrain surface's
detail texture through the `detailField` slot. This reuses the texture already
included in the signed terrain-surface asset: both presenters bind its RGBA
texels with linear filtering and repeat addressing. The paired generic fixture
verifies the binding using the shared terrain-detail bytes, but does not
establish production-world visual parity. The graph also exposes
`translucency` and `specularIntensity`
through the shared material contract; WebGPU writes its existing surface fields,
and WebGL maps them into its standard physical-lighting path. Paired generic GLB
render fixtures exercise those outputs, but do not establish Tidewater material
or visual parity. Tidewater's generated ground-cover graph now combines these
outputs with the authored density, detail, wind, terrain-height, color, and
category-fade behavior. The active signed package references the patch assets.
Matched production views against the pre-split WebGPU reference remain a parity
gate.

The ground-cover field is only the dense-flora contract; it does not cover the
finite vegetation set. Tidewater's placement asset has ten authored categories
(palms, trees, bananas, shrubs, young palms, ferns, monsteras, elephant ears,
heliconias, and strelitzias), while the WebGPU presenter merges several
categories into custom geometry and creates tree/shrub canopy impostors. Keep
the placement records, exclusion rules, and category-to-asset mapping in
Tidewater. The world export pipeline should cook each finite plant and canopy
LOD into signed, renderer-neutral GLB assets and reference them through
`elsemesh.static-model-instance-set/1`; use standard glTF PBR or
`elsemesh.material-graph/1` for authored appearance and shared wind inputs.
The material graph now accepts three semantic-neutral VEC4 streams from
`_ELSEMESH_VDATA`, `_ELSEMESH_VDATA1`, and `_ELSEMESH_VDATA2` in both backends,
enough to carry the plant builder's vertex, material, and canopy-lobe parameters
as signed GLB data while keeping their interpretation in world-authored graph
data.
`textureSampleLevel` can now also feed vertex outputs, with the same signed
glTF texture bound in WebGPU, WebGL color, and WebGL depth/shadow materials.
The material graph also provides `valueNoise2`, compiled from the same authored
operation to WGSL and GLSL; Tidewater's inactive palm migration sidecar uses it
for bark mottling. This adds a portable material primitive, not an active
vegetation migration or a parity result.
The graph also exposes `worldVertexPosition`, computed after object and instance
transforms but before graph deformation, so vertex texture coordinates can stay
anchored across instances. ElseMesh now accumulates world-heading and wind-velocity
integrals separately per world root, sends the active root's values to both
backend graph compilers, and places the destination root's values in the portal
view frame. These are generic inputs for a traveling wind field, but Tidewater
has not yet authored graph data that consumes them. Its old presenters remain
until the complete plant parity gate.
ElseMesh then owns LOD selection, instance batching, wind translation, depth,
and shadow presentation for both backends. Do not carry the current WGSL vertex
attributes, WebGL adapters, or atlas-generation presenter into that contract.
The migration is complete only when the signed package preserves every category
and LOD, both engine renderers use those same assets and material data, and the
matched visual gate passes against pre-split WebGPU.

The shared `GroundCoverCellPlanner` now owns density-cell occupancy, terrain
bounds, distance bands, and optional frustum filtering. Tidewater's WebGPU grass
uses its per-band cell lists; the WebGL density-mask path uses the same active
cell selection and per-band assignments, including for the built-in package.
The built-in package indexes the signed `grass-density/1` asset, and the WebGL
ground-cover renderer now requires that authored field and the engine planner;
it no longer invents Tidewater grass by reading sand/rock/path terrain channels.
WebGL now uses the shared 88 m range, thins blade counts by distance, and drops
oats and creepers from its farther bands. Its candidate LOD uses deterministic
screen-door selection in the planner's 12% transition zones. It still builds a
different blade mesh and applies only a basic vertex sway driven by shared time,
wind direction, and speed. It does not match WebGPU's per-species deformation,
gust, or blade fade policy; the output has not been visually compared against the
pre-split WebGPU field. This is a common runtime slice, not completion of the
ground-cover contract or renderer parity.

Do not switch Tidewater to that contract until both engine adapters consume the
same signed package fixture. The fixture must verify species and placement
counts, camera-following coverage, LOD transitions, wind response, shadows, and
matched views against the pre-split WebGPU vegetation at the same camera, time,
viewport, and render scale. Preserve the WebGPU baseline; the current simplified
WebGL presenter is not an acceptable source for the migrated appearance. Remove
the Tidewater production presenters and their registration only in that complete
migration. Until then, keep the existing path and report renderer-neutral
vegetation as incomplete.

### Dense ground-cover migration target

The first vegetation slice is Tidewater's dense ground cover. The signed world
describes one cell-patch arrangement for both backends: the source 8 m cells,
seeded clump, oat, and creeper slots, all five authored visual forms (meadow and
dune grass, oat stalks and heads, creeper leaves and flowers), and the source
near/mid/far geometry levels, including the source-authored distance fades for
oats and creepers. Tidewater owns those authored inputs and exports the portable
assets. The present WebGPU patch counts and ranges are the starting reference;
the WebGL 0.46 m lattice and its backend-specific omissions are not.

ElseMesh must provide one shared cell/instance list and LOD decision, then feed
the same signed patch assets, density data, per-instance data, and material
inputs to its WebGPU and WebGL adapters. Add any missing renderer-neutral graph
inputs for density sampling, terrain height, and wind to ElseMesh's bounded
material contract and compile each input for both backends. Keep species
selection, density interpretation, geometry, palette, and LOD asset identity in
the signed world data; backend shaders may translate that contract but must not
generate different placements or substitute content. Minimum-FPS adaptation may
select a coarser authored patch LOD and tune render scale or other presentation
costs. At matched settings both backends must use the same LOD asset and its
authored category fades; adaptation may not independently remove categories or
substitute a backend-specific content set.

The shared graph has the `translucency` and `specularIntensity` outputs needed
by the source foliage lighting. Tidewater authors their expressions alongside
density response, terrain alignment, wind, palette, and category fades in the
exported patch materials.

The generic paired-adapter fixture loads the exported patch set and verifies
both renderers use the same component assets and shared runtime selections.
Signed-asset source comparison now selects identical cells and near/mid/far
counts to old WebGPU at the ground-level meadow view; WebGL browser checks also
pass. There is still no matched production WebGPU/WebGL/pre-split capture across
beach poses and near/mid/far transitions. The dense-ground-cover component is
active. Finite Tidewater vegetation stays
on its world-owned presenters until its assets, shared data contract, and both
backend adapters pass the corresponding migration and visual gates.

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
