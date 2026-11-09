# Portable original village materials

The signed Tidewater village GLBs carry authored material appearance as
`elsemesh.material-graph/1` data and ordinary glTF textures. The final runtime
package does not use a Tidewater material profile, backend adapter, or material
component. `extras.elsemeshWorld.materialRole` preserves the authored batch
identity for diagnostics; it does not select a renderer implementation.

The eight authored roles are `wood`, `glass`, `hard`, `roofMetal`, `thatch`,
`stone`, `fabric`, and `net`. The same signed graph data is compiled by ElseMesh
for WebGPU and WebGL. Wood uses four ordinary texture slots: `baseColor` for
weathered albedo and paint chips, `metallicRoughness` for the wood normal and
roughness map, `normal` for painted timber detail, and `emissive` for linear
weathering data. The authored graph outputs the wood albedo, roughness,
occlusion, and surface normal; the emissive factor stays zero.

Each primitive retains `COLOR_0` as linear RGB tint and
`_ELSEMESH_VDATA` as a four-component material parameter. UVs keep the
meter-based coordinates and end-grain/cap markers. The exporter keeps glass in
its own graph material, folds rope into hard and cloth and flags into fabric,
and keeps nets separate. Low-detail wood triangles are split by the authored
glass marker.

The wood graph contains 768 reachable nodes, below the engine's 1,024-node
limit. It carries the source pattern relief, paint chips, end grain, deck wear,
rain and rust streaks, bird marks, and tidal wetness through the shared graph
operations. Exported-package rendering passes in hosted WebGPU and WebGL; these
checks establish backend execution, not matched visual parity against the
pre-split game. The built-in procedural village still uses Tidewater's WebGPU
texture baker to generate its source maps and remains renderer-boundary debt.
