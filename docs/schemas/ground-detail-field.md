# Ground detail field

`elsemesh.ground-detail-field/1` is a renderer-neutral component for dense,
camera-local ground detail. The engine chooses the backend implementation; the
world supplies only the placement-density data.

The component has one `ground-detail-density/1` asset reference and this data:

```json
{
  "resolution": 512,
  "texel": 2
}
```

The asset is a zlib-wrapped DEFLATE stream of tightly packed, row-major RGBA8
data with exactly `resolution * resolution * 4` expanded bytes. Its domain is
the component's installed terrain domain. `resolution` must be an integer from
2 through 2048; `texel` is the authored world-space width of a density texel
in metres.

The channels encode small-stone density, cobble density, shell/grit density,
and a regional material palette, respectively. A zero density suppresses
instances in that category. The engine samples this field while placing its
standard ground-detail geometry around the active camera; the world does not
select WebGPU or WebGL or provide renderer-specific meshes.
