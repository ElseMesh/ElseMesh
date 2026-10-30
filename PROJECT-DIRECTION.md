# ElseMesh project direction

Completion percentages below are working estimates for each named requirement,
based on the evidence and open acceptance gates in [implementation status](docs/elsemesh-status.md)
and the linked runbooks. They measure requirement completion, not code volume.
Completed milestones have been moved to [GOAL-done.md](GOAL-done.md). Reassess
these estimates when new verification evidence is recorded.

**Extension constraint: do not implement or extend Wasm.** It is too CPU-heavy.
Use the lighter owner-signed JavaScript module path in dedicated browser
Workers. The retired Wasm guard, worker, and asset validators have been removed;
do not reintroduce them as part of world-runtime work.

## Current priority: finish Tidewater package integration and parity

**Repository separation: 100% — complete.** The structural split and its
verified submodule boundary are recorded in [GOAL-done.md](GOAL-done.md).

**Tidewater package integration and parity: 75%.** This goal covers the
Example Island content now stored in the pinned Tidewater submodule. ElseMesh builds with Tidewater
mounted, verifies its content-addressed assets, and loads portable worlds
through versioned interfaces. Matched hosted/built-in start and village views
render on Android. The package includes a signed, content-addressed grass-density
mask; CPU checks prove that packaged plant placements and grass density match
seeded source generation, and that all 143 non-terrain objects have
geometry-reducing distance levels. The 2026-10-22/23 captures establish selected
hosted-versus-built-in views and grass presence, but do not yet establish visual
parity with the retained in-engine Example Island across the world.

The remaining visual parity task is to compare the retained in-engine Example
Island (the pre-split WebGPU reference) with the Tidewater package loaded by the
same ElseMesh build. Use matched device, camera pose, time, viewport, render
scale, and graphics settings for the beach, village, valley, and summit views,
plus close views where material, vegetation, or authored LOD differences are
visible. Track content omissions, terrain/material appearance, vegetation
density, object LOD transitions, water, and lighting/shadows as separate
findings. WebGL was never the visual parity baseline; check it for the same
world content and gameplay behavior as WebGPU without using its appearance as a
comparison target. Treat the existing captures as partial evidence, not
completion. Desktop WebGPU visual acceptance and complete gameplay parity
remain open. Keep Tidewater authored content and gameplay modules in its
repository, with ElseMesh providing generic browser-worker hosting, lifecycle,
and message transport. World modules are owner-signed, hash-verified JavaScript
assets executed in dedicated workers; pass versioned messages without engine
object references, bound execution time, and terminate unresponsive workers.
Keep each world's event vocabulary and gameplay rules in that world package,
not in the ElseMesh engine. Preserve
per-world state isolation and the declared shared, player, group, or persistent
scopes. Keep player platform identity across portals without leaking instance
state.

**Graphical world editor: 0%.** After package import and multiplayer acceptance
pass, build the editor in ElseMesh so it edits the mounted Tidewater repository.

The repository split itself is complete. Its boundary decisions and acceptance
record are in [GOAL-done.md](GOAL-done.md); this file tracks the remaining
product work.

## Active engine/world-separation continuation

The current implementation goal also requires finishing the behavior and
identity boundary across world packages:

- Keep reusable behavior dispatch and browser-worker hosting generic in the
  engine registry. World-owned JavaScript modules define world-specific
  events and gameplay; sign and hash their assets, pass versioned messages,
  bound execution time, and terminate unresponsive workers. Do not add
  Tidewater-specific events or gameplay rules to the engine.
- Complete the ElseMesh v3 wire and ID namespace migration without parsing old
  identifiers as a compatibility path.
- Keep Tidewater and Hogwarts authored world data in their world repositories;
  the engine supplies generic providers and versioned runtime contracts.
- Verify Tidewater gameplay against the pre-split WebGPU behavior, and check
  WebGL for content and gameplay parity without treating its visuals as a
  baseline.
- Treat avatar and vehicle presentation as portal-travelling entities. A
  destination may cap complexity or moderate participation with a signed
  allowlist of avatar profiles and permitted avatar/vehicle combinations. The
  engine owns backend-neutral transfer and enforcement; worlds author the
  accepted profiles and combinations. Current support is only a per-avatar
  stock-mesh cap and the bundled Downeast boat runtime. Signed avatar-profile
  and avatar/vehicle allowlists now gate portal and owner admission; broader
  avatar and vehicle catalogs and per-profile complexity metadata remain.

These gates are not complete merely because repository separation and the
existing registered browser behaviors are in place.

## Remaining goals

The requirements below remain part of the project's longer-term direction, but
they are secondary until Tidewater package integration and parity acceptance
are complete. Keep detailed protocols, procedures, schemas, and dated evidence
in `docs/`.

## Product requirements

- **World daemon and identity (75%):** provide the Go/libp2p `thruholdd` for Linux
  and Android/Termux, signed node/world manifests, content-addressed assets,
  distinct host/gateway/bootstrap/relay/cache roles, and no static client
  serving from the daemon, with owner-scoped neighbor caching and optional
  `thruhold.org` bootstrap links. See [ThruHolds](docs/thruholds.md),
  [world and network design](docs/world-network-design.md#design-goals), and
  [implementation status](docs/elsemesh-status.md).
- **World content and export (70%):** export deterministic, self-contained packages
  that carry the renderer's visual inputs and retain GLB collision/fallback
  data. Preserve the original island's visual quality, support the Linux FPS
  priority/Visual Quality choice, and preserve Android's full-quality path.
  Extend this with a region-provider boundary for worlds generated or decoded
  on demand: providers describe bounded regions and revisions, serve
  integrity-checked content, and support cancellation and shared host-side
  caching. Keep the signed static-package provider as the default adapter, so
  Tidewater manifests, asset hashes, startup, and package behavior remain
  unchanged while dynamic providers are introduced.
  See [world authoring](docs/world-authoring.md#replaceable-world-content-and-packaging), the
  [terrain package contract](worlds/tidewater/docs/schemas/terrain-package.md),
  [world and network design](docs/world-network-design.md#world-hosts-and-dynamic-region-providers),
  [graphics priority](docs/graphics-priority.md), and
  [graphics review](docs/graphics-review.md).
- **Bridge-backed world launch and entry selection:** allow the normal launch to
  continue opening Tidewater unchanged while an explicit command-line world
  override selects another provider/world. The selected world's data defines
  its entry prompt, choices, spawn poses, and optional appearance palettes;
  ElseMesh supplies a generic chooser and must not hardcode world names or
  house-specific behavior. Persist a visitor's choice per world and use it for
  arrival and avatar appearance. Keep implementation and evidence in
  [world and network design](docs/world-network-design.md#world-selection-and-world-authored-entry-choices)
  and [implementation status](docs/elsemesh-status.md).
- **Runtime presentation (75%):** implement distance-based object and avatar LOD
  with stable transitions and load-based recovery; preserve shared player
  presence, avatar appearance, animations, and vehicle rules. Apply the same
  package semantics in WebGL fallback, including authored object LODs and
  required world components. Dynamic regions must install and release render
  resources and collision together, and region-owned actors must support
  versioned, host-authoritative state changes without arbitrary downloaded
  scripts. See
  [world-object LOD](docs/world-object-lod.md#content-and-streaming-contract),
  [player presence](docs/player-presence.md), and
  [implementation status](docs/elsemesh-status.md).
- **Optional identity and editing (65%):** keep worlds usable without an account;
  support optional Google login, owner-signed roles/revocations, and the
  reviewable AI/Blender editing boundary. See [account roles](docs/account-roles.md)
  and [AI editing](docs/ai-editor-worker.md).
- **Portals and multiple worlds (75%):** support independently configured portal
  sides, mapped arrival orientation/travel direction, owner-authorized sharing,
  preview/entry rules, and at least two separately hosted worlds including an
  independently authored world. See [portal authoring](docs/portal-authoring.md#share-one-side-with-a-friend) and the
  [two-world test runbook](docs/testing-two-worlds.md).
- **Loading and transport (70%):** use signed experience metadata for world-specific
  loading stages and readiness, stream content by priority, and derive portal
  lighting from the downloaded destination scene. Apply the same admission and
  readiness rules over WebTransport, secure WebSocket, WebRTC, and relay paths.
  See [world and network design](docs/world-network-design.md#readiness-and-light-continuity) and
  [world and network protocol](docs/world-network-protocol.md#readiness-contracts-and-portal-light-bridges).
- **Internet reachability (60%):** provide public HTTPS/WSS gateway, discovery, and
  relay deployment for devices behind NAT. Standalone daemons remain durable;
  browser hosting is explicitly temporary while its tab is open. See
  [gateway resilience](docs/gateway-resilience.md#intended-deployment),
  [browser hosting](docs/browser-hosting.md),
  [direct WebRTC](docs/browser-direct-webrtc.md), and
  [relay deployment](docs/relay-deployment.md#publish-a-browser-gateway-with-tls).
- **ZeroTier (60%):** keep ElseMesh network `e3918db4832a3056` separate from
  `xellent` (`632ea2908569fc9e`), use embedded libzt by default, and retain an
  optional CGO-free daemon that uses a host-managed ZeroTier interface. Neither
  mode may expose Central credentials; treat physical path observations as
  transient. Verify routing, ports, peer discovery, and operation without
  Central. See [ZeroTier worldd setup and evidence](docs/zerotier-worldd.md#dedicated-elsemesh-network).
- **Publishing (90%):** host the current ElseMesh client at `elsemesh.github.io/`, retire
  `/elsemesh`, and show an eight-character source stamp matching the published
  ref. See
  [deployment](docs/deployment.md#github-pages).

## Personal ThruHold and provider failover (70%)

The hosted client may open an owner's configured personal ThruHold by default.
Invites may identify a signed ThruHold, a ZeroTier locator, and ordered
`(libp2p PeerID, HTTPS/WSS gateway)` candidates. The browser resolves and
authenticates candidates but never treats a ZeroTier ID as an IP or joins
ZeroTier. Independent desktop, Flip7, and trusted-friend providers may serve
the same owner-authorized content; owner recovery supersedes temporary
failover authority. An optional resolver/Worker is lookup/bootstrap only and
must not hold world data or credentials.

Acceptance requires independent-provider and unrelated-network checks,
provider stopover and owner recovery, resolver/gateway outage behavior, and
separate lookup/content measurements. The canonical contract and current
boundary are [gateway resilience](docs/gateway-resilience.md#identifiers-and-routes), with operating
details in [deployment](docs/deployment.md) and [browser hosting](docs/browser-hosting.md).

## Invitation-gated launch and staged portal loading (55%)

Support opt-in invitation issuance, redemption, revocation, replay protection,
world/gateway-bound admission assertions, and enforcement on every transport.
Invitation launches use the destination world's authored spawn as the preferred
entry point. Move the player only when a player or colliding object occupies
that point, choose the nearest free location within the world's configured
maximum displacement, and reject entry if the bounded area has no free
location. Portal handoffs retain their mapped destination pose and bypass this
allocation. Every world must author both its maximum visitor count and its
spawn displacement radius; Tidewater's selected values are 128 visitors and
8 m. Owner-authoritative presence atomically enforces the visitor limit and
selects a free spawn candidate, preventing simultaneous entrants from
reserving the same spot. Invitation entry fails closed when the owner cannot
admit the visitor, because capacity and occupancy cannot otherwise be checked.
Signed experience metadata must declare bootstrap, minimum-visible, and
portal-preview content; the client must hold at the threshold until crossing
requirements are met, then continue prioritized streaming. Portal lighting is a
provisional/refining result from the rendered destination scene, scoped to the
portal and bounded in cost; it is not a separately published light descriptor.

The normative requirements, wire contracts, and test plan are maintained in
[world and network design: invitation and readiness](docs/world-network-design.md#invitation-gated-entry),
[world and network protocol: admission and readiness](docs/world-network-protocol.md#invitation-admission-and-launch-grants),
and [portal authoring: preview readiness and light bridge](docs/portal-authoring.md#preview-readiness-and-light-bridge).

## Verification and completion (65%)

Run the focused source/build checks plus the live browser, two-world, gateway,
independent-network, and isolated Flip7 checks required by the linked docs.
Record dated results and remaining gates in
[implementation status](docs/elsemesh-status.md) and the relevant runbook.
Do not call the goal complete because code or local tests exist: completion
requires the documented deployment, cross-network, rendering, and content
acceptance evidence. Keep the repository clean, commit the implementation and
documentation, and push to the configured working remote where feasible.

## Bridge-driven engine evolution

Support source-backed worlds through a generic `WorldContentProvider` boundary
alongside the existing signed static-package provider. A provider may translate
an installed or otherwise authorized source into bounded, versioned regions at
runtime; it must preserve world ownership, admission, asset integrity, and
transport limits. The browser and daemon should share the same provider
contract, while a host owns one bounded RAM/disk cache shared among its
visitors. Cache entries are keyed by world, source revision, converter version,
and region, and must be evictable after they are no longer in use.

The normal world launch remains Tidewater. Add an explicit world/provider
override for bridge development and hosted deployment, with the chosen world
specified by world data or profile rather than a Hogwarts-specific branch in
ElseMesh. On entry, a world's validated metadata may present a prompt and
bounded choices that resolve to authored entry poses and appearance palettes.
The chooser is generic; world labels, choice IDs, spawn positions, and avatar
palette data are authored by each world. Retain a visitor's selection per world
and apply it consistently to invite entry and future portal entry.

This evolution is additive and must not make Tidewater depend on a bridge.
Retain its current signed manifests, content-addressed assets, startup and
rendering path as the static-provider regression baseline. Avoid a renderer or
engine replacement: keep the existing WebGPU renderer and WebGL fallback, and
extend their data interfaces for streamed geometry, textures, collision, and
dynamic entities. Detailed bridge milestones and source-specific constraints
belong in the applicable private world repository; ElseMesh owns the reusable
provider, physics, entity, identity, and compatibility contracts.


## Deferred focus: earlier entry into streamed worlds (35%)

This work remains deferred until Tidewater package integration and parity
acceptance are complete. The entry/loading objective and its implementation
notes are retained here for continuity:

## Goal (35% overall)

Let a player enter a remote world as soon as the signed manifest, spawn area,
and minimum entry content are ready. Do not keep the loading screen up until
the whole world, all background assets, or every shader variant is loaded.

The existing world streamer should continue loading visible, nearby, portal,
and background content after the first frame. Portal preparation remains a
separate readiness problem: a portal preview and a crossing must wait for the
destination content needed to render and safely cross that portal.

## Current process and blockers

Remote startup in `src/App.js` currently:

1. Fetches and verifies the world manifest.
2. Sets the signed spawn position.
3. Selects initial objects and components near or visible from the spawn,
   admitting unbounded records only through the `nearby` tier.
4. Downloads the selected initial assets, currently including the `nearby`
   tier.
5. Parses and installs those assets and components.
6. Activates the hosted world and presence, and schedules the remaining world
   content for view-driven streaming.
7. Returns from `App.init()`. The loader is hidden and the render loop starts;
   full remote-world shader precompilation and GPU warmup are deferred until
   after the first frame.

After `App.init()` returns, `src/main.js` hides the loading screen and starts
the render loop. The player’s spawn pose is known earlier, but the player
cannot be seen or move until the initial selected assets and components are
installed.

The current startup does not download every manifest asset: the initial asset
ID filter limits the request set, and unbounded records are admitted only
through the `nearby` tier. Remaining sources of entry delay include:

- selected initial assets must finish downloading before entry;
- large monolithic assets, such as terrain packages, cannot be partially
  downloaded;
- component installation can perform expensive decoding or runtime setup.

## Entry-ready phase (15%)

Define an explicit small bootstrap set required for the first usable frame:

- signed manifest and spawn data;
- collision or ground data for the spawn area;
- immediate visible and nearby geometry;
- required terrain or environment representation;
- global sky, sun, and ambient-light baseline;
- world components explicitly marked as required for entry.

Load and install only this set, then:

1. Activate the hosted world and presence.
2. Start the render loop.
3. Hide the loading screen with world-specific copy indicating that more
   content is loading.

The bootstrap contract must be explicit. Unbounded legacy objects/components
must not silently become startup blockers; give them streaming bounds or move
them into progressive loading. Keep the existing guest and signed-manifest
validation rules intact.

## Progressive phase (70%)

After the first frame, keep and extend the existing view-driven streaming:

- load objects visible through the camera;
- load nearby objects next;
- load background content afterward;
- cancel and reprioritize work when the player turns, moves, or changes portal;
- continue loading world components asynchronously;
- preserve hash verification, provider fallback, and bounded concurrency.

The existing `updateWorldStreaming()` loop already performs this work about
every 400 ms. It should remain event/view driven rather than becoming a full
world preload loop.

## Shader startup (20%)

Move full shader precompilation and GPU warmup out of the critical entry gate.
Compile only the minimum pipelines needed by the bootstrap scene before the
first frame. Compile remaining variants and perform additional warmup while the
player is already in the world. A first-use stall must be handled by the
progressive loading state rather than preventing all entry.

## Asset-format limitation (20%)

Priority labels cannot interrupt one large asset download. Truly early entry
for large worlds requires spatially chunked terrain/structure assets or a small
bootstrap collision/visual representation followed by detailed chunks. Treat
this as a packaging/content-streaming requirement, not only a client scheduler
change.

## Portal behavior (65%)

Portal previews and crossings keep their own readiness thresholds. Before showing
a useful preview, fetch the destination manifest and the structures, textures,
lights, and objects visible through the aperture, plus the destination global
environment and dominant light baseline. Show a provisional view when data is
incomplete and refine it as higher-priority destination data arrives. Hold the
player at the threshold until the destination crossing set is ready.

Portal lighting is computed dynamically from the destination scene currently
downloaded and rendered by the client. It is not an authored or signed light
descriptor. Keep any transferred effect local to the doorway and cap its cost
and intensity. Full cross-world shadow maps and global illumination remain
deferred.

## Acceptance checks (35%)

- Demonstrate that the player is visible and controllable after the bootstrap
  set completes, before background assets finish.
- Verify delayed background assets continue loading after entry.
- Verify unbounded legacy content no longer blocks entry unexpectedly.
- Verify minimum pipeline compilation permits a usable first frame.
- Verify progressive loading reprioritizes and cancels correctly as the player
  moves.
- Verify portal previews remain provisional until destination data arrives and
  refine progressively.
- Verify portal crossing still waits for its declared destination requirements.
- Verify large monolithic assets are documented as a remaining packaging gate.
- Run focused browser tests and a rendered two-world session; distinguish local
  startup success from independent-network and device acceptance.
