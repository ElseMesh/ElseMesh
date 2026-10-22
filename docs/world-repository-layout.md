# World content repository layout and file definitions

World repositories contain authored data and immutable package assets. They
are not ElseMesh applications: they do not compile or run by themselves. The
ElseMesh engine owns exporters, validators, package schemas, networking, and
runtime execution. Downloaded content may select only versioned behavior
handlers implemented by the engine; it does not execute arbitrary scripts.

The current content repositories are [Tidewater](../worlds/tidewater/README.md)
and [Burning Horizons](https://github.com/ElseMesh/burning-horizons). Tidewater
is mounted as a Git submodule. Burning Horizons is a separate checkout selected
by `BURNING_HORIZONS_DIR` when running its exporter.

## Shared package layout

```text
world-repository/
├── README.md                 # World identity, purpose, and authoring pointers
├── presentation.json         # Authoring input for loading copy and stages
├── world-source.json         # Canonical unsigned layout and behavior data
├── terrain-validation.json  # Optional exporter evidence for terrain assets
├── ASSET-INDEX.md             # Generated human-readable map of package blobs
├── assets/
│   └── <64 lowercase hex>     # Exact packaged bytes named by their SHA-256
├── lod-source/                # Authored lower-detail source meshes
└── source/                    # Editable models, textures, audio, and metadata
```

Worlds may add source-specific metadata and nested folders. For example,
Tidewater groups audio under `source/audio` and model inputs under
`source/models/{debris,props,whale}`; Burning Horizons currently keeps its cave
GLB, layout data, and ambience recording directly under `source/`.

| Path | Definition and editing rules |
| --- | --- |
| `README.md` | Human entry point describing the world repo, its layout, authoring workflow, and links to the engine contract. |
| `presentation.json` | Editable presentation input. Export copies its supported experience fields into the `experience` property of `world-source.json`; it is not a runtime package on its own. |
| `world-source.json` | Canonical, unsigned world document. It defines identity, spawn, rules, object instances, portals, versioned components, streaming bounds, and references to assets. Its complete field contract is [`world-source.schema.json`](schemas/world-source.schema.json); the authored package contract is in [world authoring](world-authoring.md). |
| `assets/<sha256>` | Immutable runtime bytes. The filename is the lowercase SHA-256 digest with no extension; the same digest appears in `world-source.json`. Only referenced package assets belong here. Do not rename a blob to make it human-readable; use the generated index. |
| `ASSET-INDEX.md` | Generated catalogue joining each hash to its manifest label or component, format, size, and any byte-identical editable source path. Do not hand-edit it. |
| `lod-source/` | Editable lower-detail meshes used by the world's exporter to create distance LOD package blobs. The resulting GLBs in `assets/` are referenced separately from their source. |
| `source/` | Editable source files and attribution. Exporters read from here to make reproducible package blobs; clients and world hosts use the verified `assets/` package instead. Source layouts are world-specific and are described in each world's README. |
| `terrain-validation.json` | Optional generated evidence for packaged terrain roles, dimensions, encodings, hashes, and renderer contracts. It does not replace the source schema or package manifest. |

World-source object and component asset IDs are the readable semantic layer:
object labels describe placed geometry; component IDs/types describe data such
as terrain surfaces, vegetation placements, reef tiles, audio, and vehicle
behavior. The asset index preserves those relationships in one human-readable
view. Component payload formats and versioned behavior contracts are listed in
[`schemas/`](schemas/).

## Per-repository notes

### Tidewater

Tidewater is the Example Island source and package at `worlds/tidewater`.
Its root `world-source.json` contains the island's stable object and component
records. `source/models/props/props.json` and `.bin` are the source glTF model
and binary buffer for vendor props; `source/models/whale/humpback.json` and
`.bin` are the whale model and buffer; the adjacent image files are source
textures. `source/audio/` contains source OGG recordings and credits.
`lod-source/` contains low-detail village and boat GLBs. See the
[Tidewater README](../worlds/tidewater/README.md) and its [asset index](../worlds/tidewater/ASSET-INDEX.md).

### Burning Horizons

Burning Horizons holds the UNDERNEATH cave world independently. Its current
`source/caves.glb` is the editable cave scene input,
`source/underneath-layout.json` contains authoring geometry such as passages,
landing areas, and the entrance, and `source/under_reef.ogg` is its ambience
source. `lod-source/cave-low.glb` supplies its lower-detail mesh. Exported cave,
LOD, and ambience blobs live in `assets/` and are linked from its
`world-source.json`. Its exporter is `tools/export-loz-underneath.mjs` in
ElseMesh; set `BURNING_HORIZONS_DIR` to the separate checkout. The repository
README and generated asset index are the content-side entry points.

## Regenerating and reviewing a package

Run the appropriate exporter from an ElseMesh checkout:

```sh
npm run export:island
BURNING_HORIZONS_DIR=/path/to/burning-horizons npm run export:burning-horizons
```

Both exporters update `world-source.json`, content-addressed `assets/`, and
`ASSET-INDEX.md`; the Tidewater exporter also writes
`terrain-validation.json`. Review those generated changes alongside their
editable source changes. The asset-index tool can verify that the committed
index is current without rewriting it:

```sh
node tools/world-asset-index.mjs --check worlds/tidewater
node tools/world-asset-index.mjs --check /path/to/burning-horizons
```

Commit package and source changes to the world repository, then update the
Tidewater submodule pointer in ElseMesh when its content commit changes. The
signed runtime manifest is separate: the owning ThruHold creates and signs it
locally. Never commit a world owner's private signing key.
