# Static fish-prop placements

`tidewater.fish-props-placement/1` is deterministic JSON placement data for the
built-in fish-prop renderer. A signed `tidewater.static-fish-props/1`
component references one content-addressed asset through `placementAssetId` and
declares `streamingBounds`. The component is streamed at its declared priority;
the Example Island uses `visible` so a distant portal preview does not download
market contents prematurely.

Each record carries the original prop kind, species, world position and
quaternion, length, skin-pattern ID, deterministic seed, body bend/jaw
parameters, and four renderer flags. The client rebuilds the existing
`FishProps` geometry, shader materials, culling, shadow proxy, and distance LOD
from these values. The asset does not contain executable shader code, geometry,
textures, collision, or procedural RNG state. Missing or non-finite seeds are
rejected rather than replaced with runtime randomness. One component may hold
up to 20,000 records and its asset is capped at 16 MiB.

The fish appearance therefore remains tied to this versioned trusted renderer
feature. A client that does not support `tidewater.static-fish-props/1` must
reject the world through its required-feature check instead of silently
substituting lower-fidelity generic PBR fish.
