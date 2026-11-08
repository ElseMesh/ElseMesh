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
| `normal` | vec3 | Local vertex normal |
| `uv` | vec2 | First texture coordinate |
| `color` | vec4 | glTF `COLOR_0` |
| `vdata` | vec4 | glTF `_ELSEMESH_VDATA` |
| `instanceMaterial0` | vec4 | First per-instance material vector |
| `instanceMaterial1` | vec4 | Second per-instance material vector |

Nodes are ordered: each operation may reference only earlier node IDs. Graphs
support at most 512 nodes. Constants are finite scalars or vectors with 2–4
components, each in the range -1,000,000 to 1,000,000.

Supported operations are `input`, `constant`, `add`, `subtract`, `multiply`,
`divide`, `min`, `max`, `pow`, `abs`, `sin`, `cos`, `floor`, `fract`, `sqrt`,
`sign`, `exp`, `normalize`, `x`, `y`, `z`, `w`, `xy`, `xyz`, `rgb`, `vec2`,
`vec3`, `vec4`, `length`, `dot`, `mix`, `clamp`, `smoothstep`, `lessThan`,
`lessEqual`, `greaterThan`, `greaterEqual`, `equal`, `not`, `and`, `or`,
`select`, `step`, and `atan2`. Operations are type checked before the engine
generates shader code. Comparisons currently accept scalar inputs and produce a
boolean for `select` and logical operations.

Outputs may be `baseColor` (vec3), `roughness` (scalar), `metalness` (scalar),
`opacity` (scalar), `emissive` (vec3), `vertexPosition` (vec3), and
`vertexNormal` (vec3). glTF PBR factors and the engine's existing base-color,
normal, and emissive texture inputs remain the starting surface values; graph
outputs modify those values. Vertex outputs also feed the WebGL depth material
so deformed geometry can keep its shadow shape.

The graph compiler and pixel fixture live in ElseMesh. The fixture checks
the same signed GLB through both static-model adapters. Tidewater has not yet
migrated its live fish-prop component or species material to this format; this
contract alone does not establish fish appearance parity.
