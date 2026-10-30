# Static model instance sets

**Status: design target; the runtime does not implement this contract yet.**

This generic package format is the intended replacement for content-specific
static renderer components. A world describes models, LOD assets, materials,
and transforms. ElseMesh selects WebGPU or WebGL and owns instance batching,
visibility, LOD transitions, shadows, and GPU resources.

## Package shape

A signed component references one content-addressed JSON asset with kind
`static-model-instance-set/1`. The asset has this shape:

```json
{
  "format": "elsemesh.static-model-instance-set/1",
  "models": [
    {
      "id": "market-table-fish",
      "bounds": { "center": [0, 0.1, 0], "radius": 0.6 },
      "lods": [
        { "assetId": "sha256:...", "enterBelowProjectedRadius": 0.018 },
        { "assetId": "sha256:...", "enterBelowProjectedRadius": 0.004 }
      ],
      "shadowLod": 1,
      "shadowMaxDistance": 22
    }
  ],
  "instances": [
    {
      "model": "market-table-fish",
      "position": [1, 2, 3],
      "rotation": [0, 0, 0, 1],
      "scale": [1, 1, 1]
    }
  ]
}
```

Each model asset is a GLB using core glTF materials and local-space geometry.
LOD entries are ordered from highest to lowest detail. `enterBelowProjectedRadius`
is the normalized projected radius at which that level becomes eligible; the
engine applies one shared transition policy across renderers. Model bounds are
in local space and drive culling and streaming. Instance transforms use a
normalized quaternion and positive scale. Additional standard glTF material
variants may be referenced by a model, but the package cannot contain shader
source, renderer names, backend flags, or engine class names.

The component's streaming bounds enclose the transformed model bounds. Asset
references are content-addressed and verified by the signed manifest before
loading. The engine rejects unknown format versions, missing model/LOD assets,
invalid transforms, duplicate model IDs, and records that exceed configured
count or byte limits.

## Separation and parity gates

This contract is generic: no fish, Tidewater, WebGPU, or WebGL concepts appear
in its fields. Tidewater can use it for hosted market contents by exporting its
authored models and placements as ordinary assets. Its fish placement codec,
species data, and game rules remain world-owned. The engine implements the same
instance selection and LOD policy for WebGPU and WebGL.

The current WebGL fish-prop mesh expansion is not a valid implementation of
this target: it loses the WebGPU skin appearance, per-instance culling, LOD
cross-fade, and near shadow proxy. Migration is complete only after both
renderers consume the same signed package data and rendered results are checked
against the pre-split WebGPU fish-stand baseline, including distance transitions,
culling, and shadows. Live fish-stand, catch-display, and portrait rendering
need a dynamic instance-set form after this static package contract is proven.
