# Reusable world-object levels of detail

Status: signed contract, runtime switching, and complementary screen-door
transitions implemented; the portable island village, static moored lobster
boat have authored lower-detail variants. Matched-view
visual validation remains outstanding.
Avatar distance LOD is implemented separately in `RemoteAvatar.js`.

## Existing renderer paths

Terrain uses CDLOD geomorphing. Procedural vegetation uses geometry levels and
impostors with dither transition bands; scanned debris, fish and reef also have
authored levels. Keep these paths and their close-range appearance.
`WorldPackage.js` currently clones one full GLB for each signed asset instance;
visibility-prioritized loading in `WorldStreaming.js` does not reduce its mesh.

## Content and streaming contract

### Coarse-first instance streaming

This object-level contract keeps a full-detail base asset and lower-detail
variants. It remains useful for ordinary single-object LOD. For repeated static
models that must stream coarsest first, use the generic
[`static-model-instance-set` contract](schemas/static-model-instance-set.md):
its shared planner and WebGL/WebGPU runtime load the coarse level first and
fetch finer variants lazily. Keep collision independent from every visual
detail choice.

An asset instance may declare optional signed `lods`, ordered from medium to
lowest detail, each referencing a distinct content-addressed GLB and a decreasing
`maxScreenFraction` threshold. Keep the existing `assetId` as full detail and the
collision source. Validate bounded level counts, threshold ordering, referenced
GLB types, and compatible bounds/transforms in source import, server manifests,
client verification and AI/Blender authoring. Geometry alternatives must retain
materials, UVs and silhouettes; do not drop arbitrary runtime triangles.

Separate variant assets let distant and portal views acquire small meshes first.
They also allow neighbors to cache each variant with the existing owner-scoped
permissions. Geometry variants must not change collision or gameplay authority.
A persistent instance wrapper owns its world transform; visual children may be
replaced without moving the object or rebuilding collision. Keep a usable level
while asynchronously loading its replacement; abort and reject stale loads on
handoff. Use hysteresis and transition rendering to avoid oscillation and popping.
Variant choice is a visual-quality decision; the shared engine streaming
scheduler decides which regions and assets to request from world traversal
reachability and expected arrival, then uses view size and proximity to choose
the suitable variant. See [reachability-driven content scheduling](world-network-design.md#reachability-driven-content-scheduling).

### Current-view coarse-coverage barrier

Before starting mesh-LOD or texture-mip refinement, the engine must make sure
every bounded visual candidate intersecting the current camera frustum has its
coarse geometry and coarsest usable texture level installed. The coarse pass
includes candidates from every authored priority tier; priority tiers must not
hide in-view structure behind nearby props. Within that pass, order assets by
projected screen coverage first, then use authored priority and distance to
break ties. Collision remains an independent earlier request class.

Do not require a world to label a view "indoors" before enforcing this
barrier. When a world provides validated room or visibility-zone data, the
engine may use it to extend candidate discovery through open portals and
identify the opaque shell whose absence would expose the sky. The world owns
those zone and portal facts; the engine owns the query and scheduling policy.
A zone label alone does not prove occlusion or complete geometry. Without
validated zone data, use the complete bounded frustum candidate set and keep
coverage unverified if its authored bounds or streamed layers are incomplete.
Never release a coverage gate merely because indoor metadata is unavailable.

Do not start new mesh or mip upgrades while this current-view coarse set is
incomplete. Re-evaluate it when the camera moves enough to expose new content;
resume refinements immediately when the coverage gate opens, even if the camera
has not moved. This
barrier coordinates the already independent mesh and texture selectors without
combining their cache entries or delaying entry for high-detail data. The world
provides bounds, traversal semantics, and valid coarse/fine tiers; the shared
engine owns selection, ordering, gating, and both renderer implementations.

For a static-model instance set, request coarse GLBs on demand for models with
instances in the current view. Rank coarse candidates by projected screen
coverage, then distance; this lets large wall, window,
and ceiling silhouettes arrive before fine prop work. Keep model and LOD array
indices stable as individual models arrive. The current-view coverage gate
remains closed until every visible model has its coarse level; then finer
upgrades can begin. Offscreen models wait until the view reaches them. This is
frustum-based coverage, not occlusion culling.

After the barrier opens, queue mesh and texture upgrades by the nearest visible
surface that benefits from each request. If large bounds make both surface gaps
zero, use bound-center distance to break that tie before projected screen
coverage (and screen benefit per transfer byte for texture mips), then stable
asset/model identity. This keeps a large far-wall bound from outranking a
nearby bench merely because both bounds overlap the camera. Keep mesh upgrades
sequential per model so a finer level is not requested before its preceding
level is available. All static-model
components in one world package share a deferred, single-active mesh queue;
texture mips use a separate queue with the same near-first rule. Deferring the
mesh queue's first dispatch lets the engine collect requests from every
component updated in the frame before it starts the highest-priority upgrade.
Ordinary world-object variants also use a deferred shared queue and rank
eligible loads by nearest visible bound, so component discovery order does not
let farther objects jump ahead of nearer ones.

At neutral render load, keep one authored refinement step ahead of the
screen-size target for visible static models and progressive textures. This
headroom makes nearby small objects eligible for refinement even when their
source-authored screen threshold has not yet selected the finer level. The
shared queues then deliver those steps by nearest visible surface before
farther detail. Preserve each source threshold for additional refinements;
sustained render-load bias cancels the headroom first and then shifts selection
toward coarser levels. Thus the headroom is a bounded streaming lead, not a
replacement for the source LOD data or a request for full detail everywhere.

Queue order still applies only to refinements selected by this combined
screen-size and headroom rule. A farther surface can remain eligible for a finer
level than a nearer one, but the nearer eligible upgrade is delivered first.
Keep texture priority tied to the nearest visible use of a shared texture asset.

### Texture mip streaming and cache identity

Geometry LODs must not require a separate copy of the same texture at each
level. Give a texture a content identity independent of the mesh or region that
references it, and make its filtered mip levels independently addressable.
The engine should request a small mip first for a reachable, farther region,
then fetch finer mips as arrival and projected size warrant. Region payloads,
the host's shared RAM/disk caches, and each browser's RAM/persistent cache must
reuse the same verified texture-mip content IDs across geometry LODs and
regions. The browser should retain a usable coarse GPU level while finer levels
arrive, then evict decoded or GPU-resident fine levels under memory pressure
without deleting the reusable encoded cache entry.

Every byte-cache layer follows demand: store a level or range only after a
player's current view/traversal schedule requests it, key it by immutable
source identity plus level/range and digest, and update recency on use. Apply
the same identity and LRU semantics in the shared host RAM/disk caches and the
browser RAM/OPFS caches. Do not eagerly split/copy every level into every
cache. The provider may keep its existing whole response when range serving
from that representation is cheaper; the network response and browser caches
must still contain only requested ranges. Measure splitting/index overhead
before adding a separate host fragment cache.

A mip pyramid contains filtered images at successively smaller resolutions;
it is not made by simply skipping every second or fourth source pixel. A
complete conventional pyramid adds about one third to the base-level texel
count before compression, rather than requiring several independent full-size
images. KTX2 indexes its mip levels, which can support fetching a level's byte
range, but that alone does not make a texture progressively transferable. The
progressive GLB loader supports embedded KTX2 images and content-addressed
image assets referenced with `EXT_elsemesh_asset_reference`. For an external
image it can assemble geometry with the coarsest KTX2 level, retain the shared
texture identity, then range-fetch finer levels from the standalone asset
without retransmitting geometry or earlier levels. Synthetic range and
isolated Chromium WebGPU tests cover that path. This gives separate geometry
variants a way to share one encoded texture asset; it does not make a provider
emit or deduplicate those assets automatically. The Hogwarts provider still
embeds textures and selects one Unreal source mip per texture, so Hogwarts
cross-GLB reuse and independent source-mip tiers remain unimplemented. WebGPU
can retain block-aligned BC-compressed KTX2 data when the adapter supports it;
otherwise it decodes RGBA. That affects GPU storage and upload, not encoded
network or disk-cache size.

## Camera selection

Select by projected bounds and actual view resolution, with a sustained-load
bias that recovers when rendering headroom returns. Preserve full close-range
Flip7 quality with sufficient headroom. Explicitly update before scene traversal.
`MeshRenderer.onBeforeRender` is invoked only on eligible visible meshes, so a
hidden child cannot use it to reactivate itself and groups cannot select levels
there. Portal previews must use `WorldPortalView`'s mapped destination camera and
256 by 512 target, rather than the main camera or player position.

### Detail selection rule

Do not define LOD as a universal distance in metres. Use screen-space demand,
which already incorporates distance, object or texture size, camera projection,
and viewport resolution. For geometry, the engine's projected-bounds fraction
and authored `maxScreenFraction` thresholds select variants; use hysteresis so
small camera movements do not repeatedly switch levels. For textures, the
renderer samples mip levels from screen-space UV derivatives. A streaming
scheduler should use the same projected texel footprint to request the coarsest
level that can satisfy visible demand, then prioritize finer levels by expected
visible quality improvement per byte. Frustum/occlusion visibility and the
server-validated reachable traversal frontier constrain which assets may be
requested; predicted arrival may raise priority for reachable assets outside the
current view. Under a bandwidth or memory budget, defer lower-value refinements
while preserving a usable coarse level. KTX2 supplies independently indexed mip
payloads, but does not itself choose network request priorities. The current
engine scheduler estimates texture demand from projected object bounds and
texture dimensions, then prioritizes the visible mip range by projected screen
area per indexed payload byte. This is a proxy: it does not yet derive exact UV
texel footprints or include measured network latency in its score. The loader
fetches one next-finer mip at a time and keeps the coarse GPU texture usable
while replacing its resident mip window. The live provider wire path,
memory-pressure eviction, and latency-aware scheduling still need validation
and refinement.

## Verification gates

Check near/far/near selection, hysteresis, actual submitted triangle reductions,
unchanged materials/transforms/collisions, mapped portal-camera selection,
variant fetch priority, shared-resource disposal and interrupted downloads.
Compare matching near and distant views locally and on Flip7, including animated
avatars. Structural GLB checks alone are insufficient visual evidence.

## Implemented contract and runtime

`lods` contains one to three records with exactly `assetId` and
`maxScreenFraction` fields. Thresholds are finite, strictly decreasing and
between zero and one; variant IDs are distinct from each other and the base.
Streaming bounds are required. Source import and signed client/server manifest
validation enforce the contract and GLB references. The converter hashes every
variant. Proposal and Blender action updates permit validated LOD declarations.

`WorldObjectLOD` estimates the projected sphere diameter relative to viewport
height using transformed bounds and the camera projection matrix. It switches
with 12% hysteresis. Each package owns per-object controllers and persistent
instance wrappers; visual levels are independently cached under verified hashes.
Selected variants load on demand through `WorldConnector.getAsset`, keeping the
current visual until acquisition completes. Completion cannot change visibility;
the next explicit per-camera update starts a 200 ms screen-door cross-fade.
Incoming and outgoing GLB materials receive per-instance fade uniforms, including
alpha-tested color and shadow passes. If the camera reverses during a blend, the
same two levels reverse their fade without a pop; additional target changes wait
for the active blend to finish. Disposal aborts variant downloads.
Heightfield collision always traverses the base visual, even if a lower level is
currently displayed. Other collision descriptors remain unchanged.

Current limits: the base mesh is still initially acquired, and its loaded LOD
levels stay resident while the object remains loaded. When a region unloads,
the engine disposes parsed base/variant resources and releases encoded asset
bytes that no other loaded object or component references; the persistent disk
cache remains available for a later revisit. This reduces residency across
explored regions but does not evict individual LOD levels while their object
remains loaded. Selection uses screen fraction rather than a fixed target
pixel size. RenderLoadLOD supplies a bounded sustained-load bias: two seconds
above 110% of the frame-work budget increases it one level, and six seconds
below 75% restores one level. Half-second smoothing and a neutral band avoid
flapping; elapsed sampling is capped to ignore suspended-tab gaps. Intentional
frame pacing is excluded from render work. The object selector divides screen
fraction by up to four under maximum bias, but preserves the ordinary authored
selection for objects occupying at least 25% of viewport height. Avatar distance thresholds
shift gradually outside eight meters; nearby avatars always retain full detail.
Each main or mapped portal camera selects against its own distance/projection;
async downloads never switch visuals outside that explicit camera update. Object
variants use hysteresis and complementary screen-door dither cross-fades. The hosted island village declares
one lower-detail level at a 0.45 viewport-height threshold. Its checked-in GLB is
generated from the full-detail village GLB with
`tools/blender/export-world-object-lod.py` under Blender 4.3.2; the export tool
checks that all trusted village material roles, vertex tint and `_ELSEMESH_VDATA`
survive. It reduces this object from 137,888 to 48,260 triangles (65%) and from
14.3 MB to 7.5 MB. The base GLB remains the collision source and full-detail
visual. The moored lobster boat's portal-preview GLB also declares one lower-
detail level at the same projected-size threshold. Its Blender 4.3.2 variant
preserves all 12 material assignments, vertex colors and UVs, reducing it from
46,845 to 16,395 triangles (65%) and from 2.55 MB to 1.26 MB. The base GLB
remains the close-view source. The 141 scanned debris placements across four source models
now use the source GLBs' authored third mesh as their shared far LOD. It reduces
each model from 700 to 160 triangles, 500 to 119, 500 to 119, and 299 to 80,
while retaining the exact same embedded albedo bytes, UV channel, and normals.
The base and far-level bounds are combined for screen-size selection. A matched
Blender 4.3.2 comparison rendered each base/far pair with the same placement
rotation, combined bounds, orthographic camera, lighting, and resolution. The
four image SSIM scores were 0.973 (branch 01), 0.961 (branch 02), 0.992
(trunk), and 0.969 (shell). These renders show the shared texture and broadly
retained silhouettes at one sample angle; they are not browser-renderer or
Flip7 sign-off. Compare near/far views in the running world, including its
actual lighting and distance threshold, and repeat the device check when the
Flip7 is reachable.

![Matched Blender renders of scanned debris near and far LODs](images/scanned-debris-lod-review.jpg)

Recreate the individual renders with Blender 4.3.2:

```sh
blender --background --python tools/blender/render-scanned-lod-comparison.py
```

The script writes the eight PNGs to
`/var/tmp/elsemesh-scanned-lod-review/`. ImageMagick's `compare -metric SSIM`
can reproduce the four metrics above. This isolated GLB review does not include
the Example Island scene, browser post-processing, or portal cameras.

To regenerate the checked-in village level, export the full package to a
temporary directory and use its full-detail village GLB as the Blender input:

```sh
npm --prefix worlds/tidewater run export -- --out /var/tmp/elsemesh-island-full
blender --background --python tools/blender/export-world-object-lod.py -- \
  --source /var/tmp/elsemesh-island-full/assets/<village-asset-sha256> \
  --out worlds/tidewater/lod-source/village-low.glb --ratio 0.35
npm --prefix worlds/tidewater run export
```

Regenerate the boat preview variant the same way, using its content-addressed
full-detail GLB from the temporary export and writing to
`worlds/tidewater/lod-source/moored-boat-low.glb` with `--ratio 0.35`.

The checked-in low-detail GLB is a stable export input. Package export hashes it
into the signed content-addressed asset directory, so repeated exports do not
need Blender and retain deterministic world-source and asset IDs.

`test/world-object-lod.mjs` uses texture-free GLBs to establish small-level
selection and transitions, and loads the checked-in boat base and reduced GLBs
to verify asset-local bounds, far-level selection, and compatible material and
geometry installation. With `ELSEMESH_WORLD_OBJECT_LOD_RENDER=1`, headless WebGPU
renders both actual boat levels through color and shadow passes as well as the
masked synthetic transition fixture. These checks do not establish matched
near/far image fidelity. Contract tests
exercise invalid declarations and CLI hash import; Go tests cover signed validation.
To compile and render the packaged-object fade shaders through headless WebGPU,
run `ELSEMESH_WORLD_OBJECT_LOD_RENDER=1 node test/world-object-lod.mjs` from the
external build tree after copying source into it. This checks masked material
pipelines for both visible levels in color and shadow passes; it does not replace
matched-view or Flip7 visual checks.

On 2026-10-11, this headless Dawn WebGPU mode completed from the external build
tree: the masked transition compiled four pipelines, the packaged moored boat
rendered 72 draws through 48 pipelines, and the cave distance mesh rendered
145 draws through 35 pipelines. The selector, hysteresis, async race rejection,
near/far and mapped-camera transitions, collision retention, load-bias recovery,
and `test/render-load-lod.mjs` stability checks also passed. The Node WebGPU
adapter did not expose a vendor or device name, so this confirms pipeline and
draw correctness only; it is not a hardware frame-rate or matched-image result.
