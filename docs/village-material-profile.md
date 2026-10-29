# Portable original village materials

The example island's village GLB carries the original geometry and material inputs rather than flattening them into plain vertex colors. This retains the original timber grain, paint wear, roof corrosion, stone details, ropes, window glass and fabric shading.

Each material declares `extras.elsemeshMaterial` with exactly two fields:

```json
{ "profile": "elsemesh.village/1", "role": "wood" }
```

Supported roles are `wood`, `hard`, `roofMetal`, `thatch`, `stone`, `fabric`, and `net`. These select trusted client implementations from `VillageMaterials.js`; a world never supplies shader code. Unknown profiles, roles, or additional profile fields are rejected. Ordinary GLB materials without this declaration retain normal PBR handling.

For each profiled primitive, `COLOR_0` is the original linear RGB `tint` attribute and `_ELSEMESH_VDATA` is a four-component float attribute carrying the original material parameters. The loader aliases the imported `COLOR_0` buffer as both generic `color` and shader-facing `tint`; the original village shaders read `tint`, so omitting this alias leaves their tint input at zero and makes hosted wood nearly black. UVs retain the original meter-based coordinates and end-grain/cap markers. The exporter uses the original village batch packing: glass joins wood, rope joins hard, cloth and flags join fabric, and nets retain their separate material. Sign geometry retains its original wood/hard material roles.

The client binds these attributes to the original shaders and bakes `VillageTextures` before drawing. Hosted island rendering reuses the original procedural island material and texture catalog, so the package never disposes resources still owned by the App. These versioned material semantics are specific to this example's visual vocabulary; they are not a replacement for general portable PBR materials or Blender authoring.

Check an export before publishing with `node test/world-village-material.mjs PATH_TO_EXPORTED_WORLD`. Tidewater's `worlds/tidewater/test/world-export.mjs` additionally checks deterministic source and asset identity against the checked-in package.
