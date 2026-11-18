# Static model instance sets

**Status: partial.** The engine validates and decodes the data shape, loads
coarse model GLBs first, and requests finer signed variants when the shared
projected-size/distance planner needs them. WebGPU and WebGL use the same lazy
runtime and build instanced batches for each loaded level. Focused tests verify
coarse-only installation and demand-triggered finer requests on both backends;
single-level generated-GLB renders check visible pixels and shader compilation.
Per-level GPU eviction, shared texture-tier delivery, and validation against
world-specific renderer baselines remain open.

This generic package format is the intended replacement for content-specific
static renderer components. A world describes models, LOD assets, materials,
and transforms. ElseMesh selects WebGPU or WebGL and owns instance batching,
visibility, LOD transitions, shadows, and GPU resources.

## Coarse-first lazy-loading evolution

`lods` follows the common engine convention: LOD0 is highest detail and each
larger index is progressively coarser. The runtime requests the last entry first
for coarse coverage, then lazily fetches finer levels in descending index order
as view demand requires them. The shared component preload gate loads only the
instance-set descriptor; both backend adapters use the same runtime and retain
the coarsest loaded level while refinement is pending or unavailable.
Refinement requests are limited to two concurrent loads per component. Texture
bytes must be external shared assets so geometry refinement does not resend
them. Fine GPU levels are currently retained until component eviction;
per-level GPU LRU eviction remains to be implemented. Collision remains on its
independent, higher-priority path. This is the engine's generic contract for
static model sets.

## Package shape

A signed component references one content-addressed JSON asset with kind
`static-model-instance-set/1` and each referenced LOD GLB with kind `glb` in its
component asset list. The JSON asset has this shape:

Ordinary signed world packages use `sha256:<digest>` asset IDs and verify them
against the signed manifest. A dynamic local-region connector may instead
declare source-scoped lookup IDs in its bounded provider inventory, because the
GLB bytes do not exist until requested. This exception is provider-owned: the
component loader still requires every LOD ID to appear in both the connector's
manifest and component asset list, and the connector verifies each returned
GLB against its SHA-256 response ETag before storing it. Source-scoped IDs are
not a replacement for content-addressed package assets.

```json
{
  "format": "elsemesh.static-model-instance-set/1",
  "models": [
    {
      "id": "market-table",
      "bounds": { "center": [0, 0.1, 0], "radius": 0.6 },
      "geometryMirrorX": false,
      "lods": [
        { "assetId": "sha256:..." },
        { "assetId": "sha256:..." },
        { "assetId": "sha256:..." }
      ],
      "lodThresholds": [0.018, 0.004],
      "lodMetric": "projected-radius",
      "lodFadeFraction": 0.1,
      "shadowLodBias": 0,
      "shadowMaxDistance": 22,
      "drawMaxDistance": 90,
      "drawFadeStartDistance": 81
    }
  ],
  "instances": [
    {
      "model": "market-table",
      "position": [1, 2, 3],
      "rotation": [0, 0, 0, 1],
      "scale": [1, 1, 1],
      "materialData": [0, 0, 0, 0, 0, 0, 0, 0]
    }
  ]
}
```

Each model asset is a static GLB using the core glTF feature subset supported by
both renderers and local-space geometry. Skins, animation, morph targets,
non-triangle primitives, and unsupported vertex attributes are rejected.
An instance may include eight finite `materialData` numbers. The engine passes
these as two instanced `vec4` values (`vStaticMaterialData0` and
`vStaticMaterialData1`) to registered material profiles in both renderers; it
does not assign domain-specific meanings to the values. Omitted data is passed
as zeroes. The attributes are allocated only when the component uses this
field. This supports authored per-placement appearance while keeping the model
set and draw batching renderer-neutral.
`lodDistanceOffset` is a separate placement field, accepted only when its
model uses `world-distance-offset`; it is consumed by the shared planner and
is not folded into opaque material data.
On WebGL, a world material-profile runtime may also return a Three.js
`MeshDepthMaterial` alongside its color material. The static-model adapter
clones and wraps that depth material with the same per-instance data varyings
and LOD fade, allowing world-owned deformation and cutout logic to remain
consistent in shadow maps.
`geometryMirrorX` records an odd-parity source reflection. The loader reflects
the LOD geometry across local X, reverses triangle winding, and adjusts tangent
handedness. The corresponding instance rotations absorb the source scale-sign
pattern, while every serialized instance scale remains positive. This lets
mirrored source placements use per-mesh LODs without relying on negative-scale
instanced matrices, which neither renderer can cull consistently.
LOD0 is the highest-detail asset. Higher indices are progressively lower-detail
assets intended for smaller projected sizes or greater distances. With
`lodMetric` set to `projected-radius`, each `lodThresholds` entry is the
normalized projected-radius boundary for changing from LOD *i* to LOD *i+1*;
values descend as indices increase. With `scaled-distance`, each is a world
distance divided by the instance's largest scale and values ascend. With
`world-distance`, each is a camera-to-instance-origin distance in metres and
values ascend, independent of model bounds center and instance scale. This is
for authored handoff ranges defined in world space.
With `world-distance-offset`, each instance must also provide a finite,
non-negative `lodDistanceOffset`. The planner subtracts it from camera-to-origin
distance, clamped at zero, and uses that measure for LOD selection, color draw
range/fade, and shadow range. This supports authored policies that account for
an instance's actual size without coupling the engine to a world's geometry.
`lodFadeFraction` sets the transition-band width; overlapping bands are
rejected. For `world-distance-offset`, the fraction describes a band centered
on each threshold and the shared planner applies a smoothstep transition.
`drawMaxDistance` limits color rendering and `drawFadeStartDistance` begins its
screen-door fade using distance from the transformed bounds center, except that
`world-distance-offset` uses its adjusted camera-to-origin measure for both.
Shadows use the independent `shadowMaxDistance`.
Shadows use the same authored LOD family and thresholds as color rendering.
`shadowLodBias` adds an optional coarser-level bias to that shared selection;
zero keeps shadow geometry aligned with the color LOD, while positive values
reduce shadow mesh detail. Both renderers apply the same LOD transition fades
to their shadow batches. `shadowMaxDistance` independently limits which
instances cast shadows. The coarsest LOD remains the first startup request for
coarse color coverage, while a required shadow level is requested when a
caster enters range.
The renderer-neutral planner selects visible instances and complementary
incoming/outgoing LOD fades. Shadow candidates use the same multi-LOD policy
independently of camera-frustum visibility, and shadow transitions use the same
fades. Model bounds are in local space and drive frustum culling and streaming.
Instance transforms use a normalized quaternion and positive scale.
The package cannot contain shader source,
renderer names, backend flags, or engine class names.

GLB materials may use standard glTF PBR or a registered ElseMesh material
profile. When a profile is present, the active renderer resolves it through an
installed world material runtime; a missing profile renderer is an installation
error rather than a silent fallback to ordinary PBR. The component data still
contains no backend selector.

For WebGL, a profile runtime may return its material directly or return
`{ material, prepareGeometry }`. The optional `prepareGeometry(geometry,
sourceMesh)` hook can map supported custom GLB attributes to the profile's
renderer-specific geometry inputs before the generic instance attributes are
drawn. The instance-set adapter does not assign domain-specific meanings to
those attributes.

The component's streaming bounds enclose the transformed model bounds. A
bounded component is an engine-owned streaming unit: it is installed when
selected for the view, retained while within its authored maximum distance,
and disposed after leaving that distance with a small hysteresis margin. Its
GPU runtime and component-only asset references are released when no remaining
loaded object or installed component uses them. This releases the connector's
RAM copy; it does not delete the browser's persistent disk-cache entry. A later
request can reload those bytes from the shared, quota-bounded LRU disk cache.
Components without bounds are world-lifetime systems and are not
distance-evicted. Asset
references are content-addressed and verified by the signed manifest before
loading. The contract validator rejects unknown format versions, invalid
transforms, duplicate model IDs, invalid or overlapping LOD thresholds, and
records that exceed its configured count or byte limits. The package resolver
checks each referenced GLB against the signed asset inventory, fetches it
through the content-hash-verifying connector, and validates its static feature
subset before either backend installs it.

## Separation and parity gates

This contract defines only static models, transforms, LOD, visibility, and
shadow inputs. It contains no world behavior or renderer selector. Each world
repository owns the export mapping from authored content to this package and
the acceptance checks for its original appearance. The two engine adapters
share instance visibility, visual LOD selection/fades, and transform records;
their shadow selection strategies currently differ as described above.
Isolated browser checks prove each backend renders a generated fixture and
compiles its supported color and shadow programs, not that any world's full
presentation has been migrated.

A world migration must preserve behavior and visual features that its existing
content-specific renderer supplied, including material appearance, per-instance
culling, LOD transitions, and shadow proxies. Both backends must consume the
same signed package data and be compared with that world's declared baseline.
Dynamic objects need a separate versioned behavior contract rather than being
encoded as static instances.
