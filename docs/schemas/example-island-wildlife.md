# Example Island wildlife component

`tidewater.example-island-wildlife/1` opts a packaged ThruHold into the trusted Example Island wildlife simulation: gulls, terns, pelicans, frigatebirds, shorebirds, ghost crabs, and hermit crabs. The component carries deterministic placement inputs; the versioned client supplies animation, behavior, geometry, and rendering.

```json
{
  "id": "tw-component:island-wildlife",
  "type": "tidewater.example-island-wildlife/1",
  "profile": "example-island-wildlife-v1",
  "seed": 5,
  "priority": "visible",
  "streamingBounds": { "center": [0, -4, -40], "radius": 300 },
  "roofPerches": [[1, 3.5, 2]],
  "footprints": [{ "x": 1, "z": 2, "r": 3 }]
}
```

`roofPerches` contains at most 64 finite world-space XYZ points exported from authored structures. `footprints` contains at most 256 exclusion circles with finite XZ coordinates and positive radius. These records keep the hosted simulation from inventing perches or placing burrows inside exported buildings. The stable seed is an integer from 1 to 2³²−1.

Wildlife requires exactly one `tidewater.terrain-surface/1` component whose priority is equal to or earlier than wildlife. This prevents constructing terrain-dependent animals while an open portal shows only preview geometry. Use `visible` for the island wildlife tier. The packaged terrain supplies height and sand-mask queries; static vegetation and exported building records supply habitat placement; the hosted pier collision tags and boat runtime supply perches.

The component is Example Island-specific, not a general wildlife authoring language. Its current hosted behavior does not export fishing gameplay, live fish schools, remote animal authority, or a portable surf probe. The built-in procedural island remains the reference implementation. See [the terrain package contract](terrain-package.md) and [world authoring](../world-authoring.md).
