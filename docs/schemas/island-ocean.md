# Island ocean component

`elsemesh.island-ocean/1` selects the current reference-island ocean profile.
The component data is renderer-neutral; ElseMesh selects the WebGPU or WebGL
presenter. The profile requires its compatible terrain-surface data and sea
level, and a world may declare at most one instance. Use
[`water-body.md`](water-body.md) for bounded terrain-independent water.

```json
{
  "id": "elsemesh-component:ocean",
  "type": "elsemesh.island-ocean/1",
  "priority": "visible",
  "assets": [
    { "assetId": "sha256:<content-hash>", "kind": "wave-breaker-stations/1" }
  ],
  "data": {}
}
```

The optional `wave-breaker-stations/1` asset contains the world-authored
shoreline stations and sea-facing directions used by both backend presenters.
When absent, ElseMesh renders the ocean without breaker spray or lip effects.
The binary format has a fixed `EMBRKST1` header, a station count, the authored
spacing, and ordered little-endian `f32` records `(x, z, seaDirectionX,
seaDirectionZ)`. Directions are normalized. The engine validates the asset
before either backend consumes it.

The component installs the world ocean presentation. It does not create
collisions, boat authority, or server-side simulation. Terrain surface and sea
level remain separate world-authored inputs.
