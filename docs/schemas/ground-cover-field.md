# Ground-cover field component, version 1

**Status: migration contract; no production adapter is registered yet.** This
component defines the portable inputs for dense vegetation. The world supplies
signed density and GLB model assets plus placement, species, LOD, wind, and
shadow data. ElseMesh owns deterministic cell selection, instance generation,
GPU resources, and the WebGPU/WebGL presenters. Neither the component nor its
assets select a backend or contain shader source.

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
        "densityChannel": 1,
        "densityThreshold": 8,
        "modelAssetIds": [ "sha256:<near-model-hash>", "sha256:<far-model-hash>" ],
        "lodMetric": "scaled-distance",
        "lodThresholds": [ 46 ],
        "lodFadeFraction": 0.12,
        "drawMaxDistance": 88,
        "drawFadeStartDistance": 81,
        "scaleRange": [ 0.7, 1.3 ],
        "windInfluence": 1,
        "castsShadow": false,
        "shadowMaxDistance": 0
      }
    ]
  }
}
```

`densityAssetId` must identify exactly one signed `grass-density/1` asset. Its
four RGBA channels are assigned to at most four species by `densityChannel`;
the meaning of each channel is data, not an engine enum. Each species references
one to four signed static GLBs, ordered coarsest to finest, and must declare the
same LOD metric and thresholds understood by the static-model contract. The
asset references must also appear in the component's signed asset list.

`blue-noise/1` gives both renderers the same deterministic candidate positions
for the signed `seed`, `cellSize`, and `pointsPerCell`. Density sampling decides
which candidates exist. The engine uses the shared distance bands and cell
capacities to maintain camera-centered coverage; backend frustum culling may
reject additional cells but cannot change candidate placement or species
selection.

Species GLBs use standard glTF materials or `elsemesh.material-graph/1` data.
The graph may use the shared time, wind direction, and wind speed inputs for
vertex deformation. `windInfluence` scales that declared behavior per species;
it does not select a renderer implementation. `castsShadow` and
`shadowMaxDistance` are shared intent consumed by each backend's shadow path.

The validator rejects unknown fields, duplicate species or channels, unsigned
or undeclared assets, invalid LOD thresholds, out-of-range distances, and
unbounded counts. Tidewater must not switch to this component until both engine
backends consume one signed fixture and matched images preserve the pre-split
WebGPU vegetation at identical camera, time, viewport, and render scale.
