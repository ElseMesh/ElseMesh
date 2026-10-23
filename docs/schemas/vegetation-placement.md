# Vegetation placement asset, version 1

`tidewater.vegetation-placement/1` is a compact binary asset for vegetation components. Its SHA-256 covers the entire byte sequence; the owner references that hash as `placementAssetId` in the signed world manifest. The asset is advertised with kind `vegetation-placement/1` and priority `portal-preview`, so an open portal can prepare the plants before handoff. It contains placement data only. Geometry, materials, impostors, wind, and shaders remain client code.

The `tidewater.procedural-island-vegetation/1` component requires seed 7 and retains the legacy example-island meaning. The `tidewater.static-vegetation/1` component instead treats each record's `x`, `y`, and `z` as absolute world-space coordinates; it does not sample the built-in terrain. Grass density is a separate optional `grass-density/1` asset described in [grass-density.md](grass-density.md). The binary header still carries a generator seed for reproducibility and variation. Static vegetation does not compare that value with a component seed.

All integers and floats are little-endian. Version 1 layout:

| Offset | Type | Meaning |
| --- | --- | --- |
| 0 | 4 bytes | ASCII `TVP1` magic and format version |
| 4 | `uint32` | Generator seed recorded by the exporter; interpreted as content metadata for static vegetation |
| 8 | `uint32` | Number of village palms, 0–10 |
| 12 | `uint32` | Plant-kind count; must be 10 |
| 16 | 10 × `uint32` | Record counts in the kind order below |
| 56 | Variable | Groups of fixed-width placement records, in the same kind order |

The kind order is `palms`, `trees`, `bananas`, `shrubs`, `youngPalms`, `ferns`, `monsteras`, `elephantEars`, `heliconias`, `strelitzias`. Each record is 41 bytes: one flags byte followed by ten `float32` values `[x, y, z, s, sy, yaw, la, l, H, seed]`. `x`, `y`, and `z` are world-space positions in meters. Flag bit 0 indicates that `sy` was authored; when clear, the `sy` slot must be ignored. Other flag bits are reserved and must be zero.

Readers reject unknown counts, non-finite values, positions outside ±10,000 m, scales outside `(0, 100]`, per-kind counts above 100,000, total counts above 200,000, incorrect lengths, and records whose per-instance seed is outside `[0, 1]`. Do not add fields in place: define a new protocol version for an incompatible layout. Keep the checked-in generator deterministic and verify the content hash when exporting or serving the asset.
