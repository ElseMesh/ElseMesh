# Renderer-neutral material graph

World GLB materials may carry a bounded material graph in
`materials[].extras.elsemeshMaterial`:

```json
{
  "profile": "elsemesh.material-graph/1",
  "role": "graph",
  "graph": {
    "format": "elsemesh.material-graph/1",
    "nodes": [
      { "id": "skin", "op": "constant", "value": [0.72, 0.48, 0.25] },
      { "id": "rough", "op": "constant", "value": 0.42 }
    ],
    "outputs": { "baseColor": "skin", "roughness": "rough" }
  }
}
```

The GLB asset hash covers this data, so it is covered by the signed world
manifest. Graphs contain data only; shader source is rejected. ElseMesh validates
the graph, then its material compiler emits the WebGPU and WebGL implementations.
The same graph inputs and outputs are used on both backends.

Input nodes use these engine-defined semantics and types:

| Input | Type | Meaning |
| --- | --- | --- |
| `position` | vec3 | Local vertex position |
| `worldPosition` | vec3 | Final world-space position, available in fragment outputs |
| `worldNormal` | vec3 | Interpolated world-space surface normal, available in fragment outputs |
| `frontFacing` | bool | Whether the fragment belongs to a front-facing primitive |
| `pixelPosition` | vec2 | Fragment-center pixel coordinate from the viewport's top-left corner |
| `normal` | vec3 | Local vertex normal |
| `uv` | vec2 | First texture coordinate |
| `color` | vec4 | glTF `COLOR_0` |
| `colorRGB` | vec3 | RGB channels of glTF `COLOR_0` |
| `vdata` | vec4 | glTF `_ELSEMESH_VDATA` |
| `time` | scalar | Shared simulation time in seconds |
| `night` | scalar | Shared environment night level (0 = day, 1 = full night) |
| `windDirection` | vec2 | Shared world-space XZ wind direction |
| `windSpeed` | scalar | Shared wind speed in metres per second |
| `instanceMaterial0` | vec4 | First per-instance material vector |
| `instanceMaterial1` | vec4 | Second per-instance material vector |

Nodes are ordered: each operation may reference only earlier node IDs. Graphs
support at most 1,024 nodes. Constants are finite scalars or vectors with 2–4
components, each in the range -1,000,000 to 1,000,000.

`textureSample` nodes sample a signed glTF material texture in the fragment
stage at the graph-provided UV coordinate and return a `vec4`:

```json
{ "id": "wood", "op": "textureSample", "slot": "baseColor", "uv": "uv" }
```

`textureSampleLevel` has the same `slot` and `uv` fields plus an earlier scalar
`lod` node. It requests an explicit mip level, which is useful for authored
material effects that choose texture detail themselves.

The `uv` field references an earlier `vec2` node. Supported slots are
`baseColor`, `metallicRoughness`, `normal`, `occlusion`, and `emissive`; each
resolves to the matching standard glTF material texture slot. Color slots use
the texture's linearized sample, while data slots preserve their linear channel
values. Texture samples cannot feed vertex outputs. The graph chooses its
coordinates explicitly, so authors can scale or offset the `uv` input with
ordinary graph nodes before sampling. If the `baseColor` output uses a sample
from the `baseColor` slot, the engine does not multiply that texture into the
surface a second time; the graph output still multiplies the glTF base-color
factor. Sampling that slot for another output leaves the ordinary base-color
texture path intact.

Supported operations are `input`, `constant`, `add`, `subtract`, `multiply`,
`divide`, `min`, `max`, `pow`, `abs`, `sin`, `cos`, `floor`, `fract`, `sqrt`,
`sign`, `exp`, `log2`, `normalize`, `normalFromSlope`, `x`, `y`, `z`, `w`, `xy`, `xyz`, `rgb`, `vec2`,
`vec3`, `vec4`, `length`, `dot`, `mix`, `clamp`, `smoothstep`, `lessThan`,
`lessEqual`, `greaterThan`, `greaterEqual`, `equal`, `not`, `and`, `or`,
`select`, `step`, and `atan2`. Operations are type checked before the engine
generates shader code. Comparisons currently accept scalar inputs and produce a
boolean for `select` and logical operations. Texture samples are validated
against their slot, UV, and (for explicit LOD) scalar input before shader
generation. Fragment-only
`dpdx`, `dpdy`, and `fwidth` compute screen-space derivatives for scalar and
vector inputs; ElseMesh emits WGSL derivatives or the corresponding GLSL
functions for the selected backend.

`normalFromSlope` takes world position, world normal, UV, and a vec2 slope,
then applies that slope in the UV tangent frame and returns a world-space
normal. ElseMesh compiles the same derivative frame to WGSL and GLSL.

Outputs may be `baseColor` (vec3), `roughness` (scalar), `metalness` (scalar),
`opacity` (scalar), `emissive` (vec3), `occlusion` (scalar),
`surfaceNormal` (vec3 world-space), `vertexPosition` (vec3), and
`vertexNormal` (vec3). `occlusion` multiplies indirect diffuse and specular
lighting in both backends. `opacity` multiplies the surface alpha before the
glTF alpha-mask test and blending. `surfaceNormal` replaces
the current surface normal after the standard glTF normal map is applied; the
backend compiler converts its world-space value into that renderer's
coordinate space. glTF PBR factors and the engine's existing base-color,
normal, and emissive texture inputs remain the starting surface values; other
graph outputs modify those values. Vertex outputs also feed the WebGL depth
material so deformed geometry can keep its shadow shape.

The graph compiler and pixel fixture live in ElseMesh. The fixture checks the
same signed GLB through both static-model adapters. Tidewater's signed village
wood, net, glass, hard-surface and rope, thatch, fabric, stone, and roof-metal
materials use this format. The 768-node wood graph expresses the complete
authored material behavior using the existing bounded operations and four
standard glTF texture slots. The exported-package fixtures render the graph in
WebGPU and WebGL; they do not prove matched image parity against the pre-split
game. Tidewater's live fish-prop component and species material remain outside
this graph.

## Current limits and migration gate

Format `/1` samples only the five standard glTF material texture slots; it does
not define material-specific texture bundles. The graph inputs otherwise
include vertex/instance data, and the standard glTF base-color, normal, and
emissive textures are applied by the engine around the graph. The authored
Tidewater wood maps now fit those standard slots; its maps are embedded in the
signed village GLBs and no Tidewater runtime material resolver is required.

Keep material behavior in graph data or portable glTF/PBR assets. If a future
material needs more inputs, extend the renderer-neutral contract and both
compilers together. Verify package appearance against its authoritative world
baseline before claiming visual parity.
