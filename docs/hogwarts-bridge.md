# Hogwarts Legacy bridge

## Goal

The goal is a multi-user ElseMesh world sourced from the user's installed
Hogwarts Legacy copy. Players must be able to move independently, occupy
different parts of the map, and see one another as ElseMesh avatars. A shared
video stream of one game process does not meet this requirement: it gives every
visitor the same camera, save, and in-game character, and cannot place remote
ElseMesh avatars inside the game.

The preferred technical direction is an **in-memory, region-streaming content
bridge**. It reads the local Unreal IoStore packages as requested, decodes the
selected map/asset dependencies, converts the render data to an ElseMesh
runtime representation, and serves bounded regions to connected clients. It
must not create a persistent asset dump, put game data in Git, or alter the
game installation. A parser may cache derived bytes in RAM for the active
session; any on-disk diagnostic output must be explicit, temporary, and
disabled by default.

"In-place" does not mean that browsers can directly render Unreal's cooked
IoStore bytes. The ElseMesh client currently understands signed manifests and
content-addressed GLB/data assets, not Unreal packages. The bridge therefore
has to decode and translate the requested data. Renderable mesh/texture bytes
still reach clients during a session; that is not a way to make copyrighted
rendered content disappear. The private repository stores bridge source and
non-game metadata only. Confirm the applicable distribution terms before
making any bridged world available beyond authorized participants.

## Architecture and engine boundary

Keep ElseMesh as the runtime for player movement, avatars, presence, discovery,
and cross-world hosting. The bridge is a native world-content provider, not a
replacement Unreal engine and not a live screen-capture service. It should
expose a world descriptor and stable spatial regions, then decode/render each
region on demand from the installed game. The game remains closed during
ElseMesh rendering; do not inject code or attach to the game process.

The existing `worldd`/browser-host protocol assumes an owner-signed manifest
that predeclares each SHA-256 asset and byte count. `worldd` serves those bytes
from its content store and the browser caches complete GLBs. That model cannot
directly represent newly generated, session-scoped map regions. The bridge
needs a separate provider contract for a signed world descriptor, bounded
region discovery, request/cancellation, generated-content hashes, memory
budgets, cache eviction, and authorized client access. It must reuse the
world's stable identity and preserve the same admission and avatar rules; it
must not weaken static package verification.

Each streamed region needs stable bounds and identity, a limited visual
representation, a source revision tied to the installed container set, and
explicit completion/failure status. Fetch near the players first, cancel work
when no visitor needs it, and evict derived bytes under a bounded RAM budget.
Carry Unreal `UBodySetup.AggGeom` collision separately from render geometry:
box, sphere, capsule, tapered-capsule, and convex vertex/index data must retain
their local transforms and units. The current bridge encodes these BodySetup
aggregate shapes in GLB node extras as `elsemeshCollision`. It does not yet
read cooked complex triangle-mesh collision, and the browser still needs a
validated region-collision adapter before these records affect player
movement. Never silently use visual triangles as collision.

Dynamic doors are region entities with stable IDs derived from the world,
region, and source actor path. Their record must include a pivot, closed/open
transforms or an extracted motion curve, interaction reach/eligibility, and
the collision shapes that move or disable during opening. The shared host
authorizes `closed -> opening -> open -> closing` transitions and broadcasts
the transition ID, timing, and sound event so every client animates the same
door and plays its open/close effect once. A door must not become traversable
until its collider clears the passage. The converter must inspect the cooked
actor/Blueprint and animation/audio references; a static mesh name is not
enough to infer behavior. If game logic cannot be represented safely, a
compatible ElseMesh door state machine must be authored and documented per
door class. Resolve any game opening/closing audio from the installed packages
to bounded session data (or use an authorized ElseMesh-authored substitute);
store only sound references/metadata in Git. Ladders, lifts, enemies, quests,
and other gameplay logic remain separate behavior contracts.

Epic's Pixel Streaming plugin is not a switch that can be enabled on an
arbitrary packaged game. Epic's setup requires enabling the plugin in an Unreal
project and packaging that application. A desktop-capture/WebRTC sidecar could
provide a shared viewing session, but that is a separate feature and does not
meet the independent-avatar requirement.

## Map coverage and milestones

The installed build exposes hundreds of Hogwarts map packages, including
streaming, interior, exterior/LOD, lighting, collision, technical, and seasonal
variants. `Hogwarts.umap` alone is not the complete castle. The game's larger
playable world spans additional areas and transitions beyond that castle
package family.

Use these gates:

1. **In-memory renderer and collision proof:** resolve one bounded Great Hall
   region from the installed containers, decode static meshes, textures, and
   BodySetup collision without writing them to disk, convert them to a
   browser-supported representation, and render it in an isolated ElseMesh
   scene. Verify collision sample points and bounds against the Unreal source
   data and record visual and geometric limits.
2. **Castle traversal slice:** identify the correct streaming map/asset
   dependency graph and cover a connected castle route, not just one interior
   room. Adapt and validate the extracted Unreal collision shapes in the
   browser physics path. Add door interaction, synchronized door motion and
   sound, region bounds, and transitions so separate ElseMesh players can
   walk between regions and open passages together.
3. **Full castle:** cover all playable castle wings and vertical routes, using
   the game's stream partitions as input where they map cleanly to world
   regions. Exclude editor-only, seasonal, lighting-only, and LOD alternatives
   unless needed by the active runtime state.
4. **Full game world:** extend the same provider to the outdoors, Hogsmeade, and
   other traversable areas, including transitions and consistent world-scale
   coordinates. Treat this as a substantial later milestone, not implied by
   passing the castle slice.

At every stage, test two or more independent clients with avatars in separate
regions. Verify region streaming and presence across boundaries. This is the
acceptance check that distinguishes a multi-user world from a single shared
game stream.

## Host identity, ZeroTier, and browser hosting

Keep these identifiers distinct:

- `worldId` identifies the ElseMesh world;
- **HostID** is the stable ElseMesh profile PeerID derived from its persistent
  `node.key`, bound to `worldId` in a signed provider advertisement;
- ZeroTier NodeID and network ID are optional transport locators. ZeroTier
  roots help overlay nodes establish paths; they do not register ElseMesh
  worlds, prove ownership, or grant network membership. The configured
  ZeroTier controller remains the authority for membership.

ElseMesh's signed directory/resolver and configured gateway perform
application-level discovery. A browser host can reuse the owner's HostID and
serve bridge requests through the gateway without running a ZeroTier stack.
The ZeroTier NodeID is a route hint only, after the signed ElseMesh identity
has been checked.

## Per-world avatars

Per-world avatar selection is a native ElseMesh feature. World metadata should
select a bounded, versioned catalogue; each visitor chooses their own avatar
from that catalogue within world-specific complexity/animation caps. The
current client uses a fixed stock avatar list and a global local preference,
so per-world selection is not implemented. The bridge must report the game
world's renderer/content limits so avatar limits can be chosen safely, but it
must not execute arbitrary code from the game packages.

## Repository boundary and current prototype

The private [`Hogwarts-World`](../worlds/Hogwarts/README.md) subrepository holds
bridge code, design documents, and non-game metadata. It must not contain game
models, textures, animations, captures, saves, or generated world packages.

The current memory prototype converts static mesh geometry from a selected
map into a bounded GLB byte array. A Great Hall byte array has been accepted by
ElseMesh's GLB loader and rendered in a headless scene. It now includes
available `UBodySetup.AggGeom` simple and convex collision data in node extras,
but no browser physics adapter consumes those extras yet. The preview omits
textures/materials. Dynamic doors, synchronized opening/closing sounds,
region-provider networking, connected castle traversal, and multi-avatar
acceptance are not implemented. The previous disk-export experiment has been
removed so the supported bridge path cannot accidentally export a map to a
file tree.
