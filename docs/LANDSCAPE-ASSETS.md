# Landscape asset registry

`src/world/LandscapeAssets.js` is a reusable, immutable metadata registry. It loads no models, calls no providers and imports no renderer. A future builder must validate asset IDs before persisting or loading placements, and a public runtime must retain the default `publicRuntime: true` gate.

Exports: `LANDSCAPE_ASSETS`, `getLandscapeAsset(id, registry?)`, `listLandscapeAssets({ publicRuntime? })`, `validateLandscapeAsset(asset, options)` and `validateLandscapeAssetReferences(placements, options)`. Validators return `{ valid, errors }`; errors have stable `code` and readable `message`, with placement `index`/`assetId` when applicable. Placements use `{ assetId, x, z, yawRadians?, scale? }`; scale is a positive uniform multiplier. Runtime units are metres, +Y is up and registry placement forward is -Z. Runtime adapters must align each building entrance deliberately.

The registry is bounded to three existing GLBs in this branch. On 15 October 2026 their file lengths and SHA-256 digests were measured locally; tests recheck those bytes. Recorded sources and licence evidence are repository acquisition records, not a fresh legal review or upstream licence revalidation.

| ID | Public placement | Evidence and limits |
|---|---|---|
| `abandoned-warehouse` | Eligible | Arsen Ismailov, CC BY 4.0, `CREDITS.md`; preserve linked source, licence, author and derivative notice. Current embedded GLB is 40,703,788 bytes. |
| `forest-cabin` | Eligible | 3dquads blender, CC0, `CREDITS.md`; current embedded GLB is 8,289,512 bytes. |
| `warehouse-image-guided` | Blocked | Existing specification says “local experiment only”; code ownership does not override that recorded restriction. |

Later Argon and cottage experiments are omitted from this branch because their redistribution and privacy status is unresolved. They remain in the isolated local experiment and are not prerequisites for this builder.

Unknown rights block public placement even when a file already exists in `public/`. `publicRuntime: false` permits metadata inspection of experimental entries; it is not public release authorization. Unregistered models (including provisional vehicles and user scans) are excluded until separately admitted. No asset or raw reference photograph is copied by this registry. The existing experimental gallery remains a separate opt-in integration; this change does not grant it new rights.

Supply `availablePaths`, an iterable of public URL paths, to either validator to reject missing GLB or manifest files during import/build. Browser validation alone checks metadata and IDs; it cannot prove file existence, source ownership or hash integrity. The Node tests verify actual registered GLB bytes, manifest existence, provenance-document existence and absence of external GLB image/buffer dependencies. Private source files are never requested by browser code.

All entries explicitly specify `collision.mode: 'none'`: this registry creates no collider. A runtime adapter must provide floor/wall/entrance proxies before claiming a building is traversable. Validated `boxes` metadata is supported for future adapters. Metre scale is the existing runtime's nominal scale, with no survey accuracy claim. Optimisation records capture current bytes and counts; eligibility certifies recorded redistribution metadata, not streaming, rendering performance or physical quality. Do not instantiate the 40 MB warehouse per tile or claim this registry supplies LOD/mesh optimisation. The cabin's old CREDITS triangle total was not copied into the registry because the current GLB's primitive index inventory differs; bytes and hashes remain authoritative for identity.

Run `node --test test/landscape-assets.mjs` to verify the registry and on-disk asset identity. The builder integration is separately exercised by `npm test`.
