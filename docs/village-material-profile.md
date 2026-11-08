# Portable original village materials

The example island's village GLB carries the original geometry and material inputs rather than flattening them into plain vertex colors. This retains the original timber grain, paint wear, roof corrosion, stone details, ropes, window glass and fabric shading.

Each material declares `extras.elsemeshMaterial` with exactly two fields:

```json
{ "profile": "elsemesh.village/1", "role": "wood" }
```

The historical role vocabulary is `wood`, `hard`, `roofMetal`, `thatch`, `stone`, `fabric`, and `net`. `roofMetal`, `thatch`, `stone`, `fabric`, and `net` now use signed `elsemesh.material-graph/1` data compiled by ElseMesh for both backends. Only `wood` and `hard` still use the Tidewater-owned legacy WebGPU and WebGL material adapters. No world supplies backend shader code. Unknown profiles, roles, or additional profile fields are rejected. Ordinary GLB materials without a profile or graph retain normal PBR handling.

For each profiled primitive, `COLOR_0` is the original linear RGB `tint` attribute and `_ELSEMESH_VDATA` is a four-component float attribute carrying the original material parameters. The loader aliases the imported `COLOR_0` buffer as both generic `color` and shader-facing `tint`; the original village shaders read `tint`, so omitting this alias leaves their tint input at zero and makes hosted wood nearly black. UVs retain the original meter-based coordinates and end-grain/cap markers. The exporter uses the original village batch packing: glass joins wood, rope joins hard, cloth and flags join fabric, and nets retain their separate material. Sign geometry retains its original wood/hard material roles.

Tidewater's remaining legacy wood and hard materials bind these attributes to its WebGPU shader and WebGL adapter, using the same packaged `VillageTextures`. The migrated roles carry their data graphs and standard glTF texture slots in the signed village GLB. These versioned material semantics are specific to Tidewater's visual vocabulary; they are not a replacement for general portable PBR materials or Blender authoring.

Check an export before publishing with `node test/world-village-material.mjs PATH_TO_EXPORTED_WORLD`. Tidewater's `worlds/tidewater/test/world-export.mjs` additionally checks deterministic source and asset identity against the checked-in package.
