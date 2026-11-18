# Ground-cover field component, version 1

**Status: generic WebGPU and WebGL adapters are registered and covered by a
shared signed-asset render fixture. Tidewater has not switched to this
component.** This component defines the portable inputs for dense vegetation.
The world supplies signed density and GLB model assets plus placement, species,
LOD, wind, and shadow data. ElseMesh owns deterministic cell selection,
instance generation, GPU resources, and both backend presenters. Neither the
component nor its assets select a backend or contain shader source.

```json
{
  "type": "elsemesh.ground-cover-field/1",
  "assets": [
    { "assetId": "sha256:<density-hash>", "kind": "grass-density/1" },
    { "assetId": "sha256:<near-model-hash>", "kind": "glb" },
    { "assetId": "sha256:<far-model-hash>", "kind": "glb" }
  ],
  "data": {
    "densityAssetId": "sha256:<density-hash>",
    "seed": 7,
    "cellSize": 8,
    "pointsPerCell": 384,
    "placementAlgorithm": "blue-noise/1",
    "distanceBands": [
      { "maxDistance": 18, "cellCapacity": 48 },
      { "maxDistance": 46, "cellCapacity": 160 },
      { "maxDistance": 88, "cellCapacity": 420 }
    ],
    "species": [
      {
        "id": "meadow-grass",
        "densityExpression": { "op": "channel", "index": 1 },
        "densityThreshold": 8,
        "modelAssetIds": [ "sha256:<near-model-hash>", "sha256:<far-model-hash>" ],
        "bounds": { "center": [ 0, 0.5, 0 ], "radius": 0.8 },
        "geometryMirrorX": false,
        "lodMetric": "scaled-distance",
        "lodThresholds": [ 46 ],
        "lodFadeFraction": 0.12,
        "drawMaxDistance": 88,
        "drawFadeStartDistance": 81,
        "scaleRange": [ 0.7, 1.3 ],
        "castsShadow": false,
        "shadowMaxDistance": 0
      }
    ]
  }
}
```

`densityAssetId` must identify exactly one signed `grass-density/1` asset. Each
species has a bounded `densityExpression` over the field's four normalized RGBA
channels. Supported nodes are `channel` (index 0–3), `constant` (finite value),
and binary `add`, `subtract`, `multiply`, `divide`, `min`, and `max`. Expressions
are limited to 64 nodes and 12 levels; division by a value near zero returns
zero, and the final density is clamped to 0–1. This lets a world describe blends
such as Tidewater's dune/meadow grass density without giving the renderer
Tidewater-specific channel meanings. In `blue-noise/1`, expressions affect
candidate presence; species-specific appearance is carried by its model assets
and material data.

Each blue-noise species references one to four signed
static GLBs, ordered coarsest to finest, and declares the same LOD metric and
thresholds understood by the static-model contract. The asset references must
also appear in the component's signed asset list. Its authored bounds and
reflection parity use the same semantics as
`elsemesh.static-model-instance-set/1`, allowing both field adapters to use the
engine's shared visibility, LOD, transition, and shadow planner.

The `world-distance` metric measures from the instance placement origin in
metres and ignores instance scale and the model bounds center. Use it when a
world authors LOD handoffs at fixed world-space distances.

`blue-noise/1` gives both renderers the same deterministic candidate positions
for the signed `seed`, `cellSize`, and `pointsPerCell`. It creates one
Mitchell-best-candidate pattern using the engine's `mulberry32/1` integer
sequence: candidate 0 uses one sample; each later point takes the best of ten
samples by minimum toroidal squared distance, with the first sample winning
ties. `pointsPerCell` is bounded to 1–4096 so the quadratic pattern generation
has a fixed upper bound. It then applies a deterministic per-cell rotation and translation
derived from the seed and cell coordinates.
Each species evaluates its density expression over bilinearly sampled RGBA
channels; a candidate is selected when its seeded value is below that density.
Scale and yaw use separate ID-seeded values, so changing the camera or selected
LOD cannot move an instance. The engine uses the shared distance bands and cell
capacities to maintain camera-centered coverage; backend frustum culling may
reject additional cells but cannot change candidate placement or species
selection.

`fixed-cell-patch/1` is for a signed GLB whose geometry already contains the
world-authored arrangement for one whole cell, including any species categories
that share that patch. It requires `pointsPerCell: 1` and exactly one species
model set. The species density expression identifies the RGBA channels that
make a cell occupied; it does not scatter or randomly filter instances. The
engine emits one instance at each occupied cell's exact origin with identity
rotation and unit scale. Its `modelAssetIds` are ordered coarsest to finest and
their count matches the distance-band count; those shared distance bands select
the matching authored patch level. This mode does not use per-species scale or
LOD-transition settings. Minimum-FPS
render-load bias may select a coarser asset from that same list, without
regenerating placements or changing patch contents.

Species GLBs use standard glTF materials or `elsemesh.material-graph/1` data.
The graph may use the shared time, wind direction, and wind speed inputs for
vertex deformation; authored wind response belongs in that renderer-neutral
material graph rather than in a renderer-specific field setting. `castsShadow` and
`shadowMaxDistance` are shared intent consumed by each backend's shadow path.

The registered WebGPU and WebGL adapters consume the same signed-density and
GLB fixture. Both select 51 visible and 45 near-shadow instances from the same
seeded camera view; WebGPU verifies that disabling the shared shadow map changes
receiving pixels, and WebGL compiles and renders the three-cascade depth path
without GL errors. These checks prove component installation and backend draw
submission, not matched visual parity for Tidewater's authored vegetation.

The validator rejects unknown fields, duplicate species, malformed density
expressions, unsigned or undeclared assets, invalid LOD thresholds,
out-of-range distances, and unbounded counts. The sum of distance-band capacities times candidate points
per cell times species count may not exceed one million visible candidate
records. The runtime releases cached cell records once they leave its active
camera coverage. Tidewater must not switch to this component until matched
images preserve the pre-split WebGPU vegetation at identical camera, time,
viewport, and render scale, including species appearance, density distribution,
wind response, LOD transitions, and shadow reach.
