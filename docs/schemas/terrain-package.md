# Terrain package fidelity contract

A terrain export is complete only when the packaged world data is sufficient for an independent compatible client to reconstruct the intended visual surface. A renderer profile or procedural seed may choose an algorithm, but it must not stand in for the content inputs that define this particular terrain.

## Required content

A portable terrain package must include, or deterministically derive from included versioned data:

- Height samples at sufficient resolution and precision for the visual surface and collision surface.
- Every terrain mask used by shading or placement, including rock, sand, paths, gullies, seagrass, rubble, and scarp masks when those features are present.
- Tileable detail textures and material parameters used for sand, soil, grass, rock, beach, seabed, and any other visible material regions.
- Any baked AO, macro normals, wetness/coast fields, or lighting data that materially changes appearance. Dynamic lighting inputs should be identified separately from baked static inputs.
- LOD and sampling parameters, coordinate bounds, sea-level relation, color-space/encoding metadata, and a versioned renderer contract.
- A low-cost collision/portal-preview representation when it differs from the full visual representation, with explicit links between those representations.

Hashes cover the exact bytes served by world nodes and caches. Compression and quantization are allowed when the decoder is versioned and the resulting image, surface shape, and collision precision stay within the declared quality budget. A seed-only package is not portable content because it delegates important state to code that may not exist on another client.

## Fidelity acceptance

The exporter must be deterministic and write `terrain-validation.json` beside `world-source.json`. The report lists every emitted terrain asset, its content address and SHA-256, byte length, dimensions, encoding, and renderer contract. It covers the full terrain collision/fallback GLB, lower-detail portal-preview GLB, and packaged visual-surface asset. Review the exported world beside the source world with matched camera pose, viewport, time, exposure, lighting, and renderer settings. The comparison must cover the mountain, trail, beach transition, headlands, and seabed; reject exports that visibly shift material boundaries, flatten detail, or change the intended color palette. Also verify that the manifest and assets can be served from a clean node without access to the source checkout.

## Current Example Island status

`tools/export-island.mjs` emits a `tidewater.terrain-surface/1` asset alongside the GLB and writes the deterministic `terrain-validation.json` report. The binary asset carries float32 heights, baked normal/rock/AO and terrain masks, the tileable detail texture, linear palette values, base roughness/wet-darken material parameters, coordinate bounds, dimensions, and the `original-tidewater-terrain-v1` renderer profile. The GLB remains the collision and fallback representation. The renderer profile identifies the versioned shader contract; changes to that contract require a new profile version and a matched-view review against original Tidewater.

The source procedural generator is used by the exporter only. A hosted compatible client renders the packaged heightfield and maps without regenerating the island from a seed. The binary asset uses a versioned DEFLATE container; clients decompress it during component installation, so hosted terrain becomes visible only after its verified bytes are available and decoded. Keep package size limits and cache streaming behavior in mind when extending it.
