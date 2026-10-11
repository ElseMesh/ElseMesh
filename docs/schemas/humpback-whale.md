# Humpback whale component

`tidewater.humpback-whale/1` describes the Example Island's animated humpback. Its movement inputs and model bytes travel with the signed world manifest and assets; a compatible ElseMesh client supplies the versioned animation, rendering, and LOD implementation.

## Component record

The component contains only these fields:

```json
{
  "id": "tw-component:island-humpback",
  "type": "tidewater.humpback-whale/1",
  "profile": "example-island-humpback-v1",
  "priority": "visible",
  "streamingBounds": { "center": [0, -4, 200], "radius": 250 },
  "modelAssetId": "sha256:<model-json-hash>",
  "geometryAssetId": "sha256:<geometry-hash>",
  "albedoAssetId": "sha256:<albedo-png-hash>",
  "heightAssetId": "sha256:<height-png-hash>",
  "seed": 1,
  "route": [[70, 300], [60, 200], [35, 120], [5, 88]],
  "surfaceAt": 0.25,
  "cruiseSpeed": 2.6,
  "surfaceSpeed": 1.5
}
```

The actual Example Island route has nine XZ points. Routes must contain 4–32 finite points, each coordinate within 10,000 m. The unsigned seed must be positive. `surfaceAt` is a route fraction from 0 to 1; both speeds are finite values from 0 to 10 m/s. There is at most one whale component per world, and it requires explicit streaming bounds.

Each content-addressed asset is separately verified and streamed at the component's priority:

| Field | Manifest asset kind | Maximum size |
| --- | --- | ---: |
| `modelAssetId` | `whale-model/1` | 1 MiB |
| `geometryAssetId` | `whale-geometry/1` | 32 MiB |
| `albedoAssetId` | `whale-albedo/1` | 16 MiB |
| `heightAssetId` | `whale-height/1` | 32 MiB |

The model JSON gives the vertex/index byte offsets and rig metadata for the three packaged LODs. The PNG inputs include the albedo and height maps. No client fetch to a site-root `/models/whale` path is needed to load this world component.

The schema intentionally packages route, seed, surfacing point, and speeds rather than relying on the island's JavaScript defaults. The named profile still selects compatible client behavior and shader semantics; it is not arbitrary executable world logic. The component uses the hosting world's sea level and decoded terrain surface when available. Whale LODs, culling, shader behavior, surfacing sequence, and blow/splash effects remain client implementation behavior. This component does not add general bird, shore-life, fish-school, fishing, or one-shot sound simulation.

Both the browser source/manifest validators and `worldd` enforce the field allowlist, bounds, asset hashes/kinds/sizes, common streaming priority, and single-whale limit. The deterministic exporter includes these assets in the package budget. `test/whale-world-package.mjs` creates the renderer from package bytes with network fetch disabled, while `test/world-export.mjs`, `test/world-source-manifest.mjs`, `test/world-portals.mjs`, and the daemon tests cover deterministic export and validation.
