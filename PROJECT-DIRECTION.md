# ElseMesh project direction

## Current primary goal: split engine and world content

The immediate priority is to split this repository into two independently
maintained repositories with separate development lineages:

- **ElseMesh** becomes the engine repository. It should contain the reusable
  client, server, networking, rendering, world-loading, authoring, and packaging
  systems without the example island's authored world content.
- **Tidewater** is the separate world-content repository at
  `https://github.com/ElseMesh/tidewater`. It contains authored content and
  package data and is included at `worlds/tidewater` as a Git submodule.
- **Burning Horizons** is a separate content repository at
  `https://github.com/ElseMesh/burning-horizons`. Its content is developed and
  versioned independently; it is not part of Tidewater or checked into ElseMesh.

The split is complete when the engine can develop and build with the content
repository checked out at its submodule path, while the two repositories keep
independent history, releases, and development. The island content must be
packaged, hosted, and loaded through the engine's stable world-content
interfaces. Preserve the island's existing visual quality and behavior through
the split. Keep world-specific assets and authored data in the submodule; keep
generic runtime, schemas, tools, and reusable samples in ElseMesh where they
serve the engine itself. Update build, test, deployment, and documentation
references to match the new boundaries, and verify both repositories and their
integration after the move.

Tidewater content repositories are data packages, not independently
compilable applications. The package describes interactions using validated,
versioned behavior data. ElseMesh owns their authoritative execution and
multiplayer state. The first migration preserves existing Tidewater gameplay
through currently supported behavior handlers; it does not add a general
scripting runtime. State is isolated by world instance and can be shared,
player-scoped, group-scoped, or persistent when a world declares it. Player
platform identity carries across portals without carrying instance state.

After package import and multiplayer acceptance pass, build the graphical world
editor inside ElseMesh and have it edit the mounted content repository.

## Later goals

The requirements below remain part of the project's longer-term direction, but
they are secondary until the engine/content repository split is complete. Keep
their detailed protocols, procedures, schemas, and dated evidence in `docs/`.

The following requirements describe later phases of the project. Detailed
protocols, procedures, schemas, and dated evidence live in `docs/`; update
those documents rather than copying their full explanations here.


## Product requirements

- **World daemon and identity:** provide the Go/libp2p `thruholdd` for Linux
  and Android/Termux, signed node/world manifests, content-addressed assets,
  distinct host/gateway/bootstrap/relay/cache roles, and no static client
  serving from the daemon, with owner-scoped neighbor caching and optional
  `thruhold.org` bootstrap links. See [ThruHolds](docs/thruholds.md),
  [world and network design](docs/world-network-design.md#design-goals), and
  [implementation status](docs/elsemesh-status.md).
- **World content and export:** export deterministic, self-contained packages
  that carry the renderer's visual inputs and retain GLB collision/fallback
  data. Preserve the original island's visual quality, support the Linux FPS
  priority/Visual Quality choice, and preserve Android's full-quality path.
  See [world authoring](docs/world-authoring.md#replaceable-world-content-and-packaging), the
  [terrain package contract](docs/schemas/terrain-package.md),
  [graphics priority](docs/graphics-priority.md), and
  [graphics review](docs/graphics-review.md).
- **Runtime presentation:** implement distance-based object and avatar LOD
  with stable transitions and load-based recovery; preserve shared player
  presence, avatar appearance, animations, and vehicle rules. See
  [world-object LOD](docs/world-object-lod.md#content-and-streaming-contract),
  [player presence](docs/player-presence.md), and
  [implementation status](docs/elsemesh-status.md).
- **Optional identity and editing:** keep worlds usable without an account;
  support optional Google login, owner-signed roles/revocations, and the
  reviewable AI/Blender editing boundary. See [account roles](docs/account-roles.md)
  and [AI editing](docs/ai-editor-worker.md).
- **Portals and multiple worlds:** support independently configured portal
  sides, mapped arrival orientation/travel direction, owner-authorized sharing,
  preview/entry rules, and at least two separately hosted worlds including a
  LOZ-derived world. See [portal authoring](docs/portal-authoring.md#share-one-side-with-a-friend) and the
  [two-world test runbook](docs/testing-two-worlds.md).
- **Loading and transport:** use signed experience metadata for world-specific
  loading stages and readiness, stream content by priority, and derive portal
  lighting from the downloaded destination scene. Apply the same admission and
  readiness rules over WebTransport, secure WebSocket, WebRTC, and relay paths.
  See [world and network design](docs/world-network-design.md#readiness-and-light-continuity) and
  [world and network protocol](docs/world-network-protocol.md#readiness-contracts-and-portal-light-bridges).
- **Internet reachability:** provide public HTTPS/WSS gateway, discovery, and
  relay deployment for devices behind NAT. Standalone daemons remain durable;
  browser hosting is explicitly temporary while its tab is open. See
  [gateway resilience](docs/gateway-resilience.md#intended-deployment),
  [browser hosting](docs/browser-hosting.md),
  [direct WebRTC](docs/browser-direct-webrtc.md), and
  [relay deployment](docs/relay-deployment.md#publish-a-browser-gateway-with-tls).
- **ZeroTier:** keep ElseMesh network `e3918db4832a3056` separate from
  `xellent` (`632ea2908569fc9e`), use libzt identities and network-scoped
  addresses without exposing Central credentials, and treat physical path
  observations as transient. Verify routing, ports, peer discovery, and
  operation without Central. See [ZeroTier worldd setup and evidence](docs/zerotier-worldd.md#dedicated-elsemesh-network).
- **Publishing:** host the current ElseMesh client at `elsemesh.github.io/`
  and archived `loz/main` at `/loz`, retire `/elsemesh`, and show an eight
  character source stamp matching each published ref; inspect the archived
  `loz/main` implementation for reusable avatar/multiplayer work before
  replacing it. See
  [deployment](docs/deployment.md#github-pages).

## Personal ThruHold and provider failover

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

## Invitation-gated launch and staged portal loading

Support opt-in invitation issuance, redemption, revocation, replay protection,
world/gateway-bound admission assertions, and enforcement on every transport.
Signed experience metadata must declare bootstrap, minimum-visible, and
portal-preview content; the client must hold at the threshold until crossing
requirements are met, then continue prioritized streaming. Portal lighting is a
provisional/refining result from the rendered destination scene, scoped to the
portal and bounded in cost; it is not a separately published light descriptor.

The normative requirements, wire contracts, and test plan are maintained in
[world and network design: invitation and readiness](docs/world-network-design.md#invitation-gated-entry),
[world and network protocol: admission and readiness](docs/world-network-protocol.md#invitation-admission-and-launch-grants),
and [portal authoring: preview readiness and light bridge](docs/portal-authoring.md#preview-readiness-and-light-bridge).

## Verification and completion

Run the focused source/build checks plus the live browser, two-world, gateway,
independent-network, and isolated Flip7 checks required by the linked docs.
Record dated results and remaining gates in
[implementation status](docs/elsemesh-status.md) and the relevant runbook.
Do not call the goal complete because code or local tests exist: completion
requires the documented deployment, cross-network, rendering, and content
acceptance evidence. Keep the repository clean, commit the implementation and
documentation, and push to the configured working remote where feasible.


## Later focus: earlier entry into streamed worlds

This work is also deferred until after the repository split. The entry/loading
objective and its implementation notes are retained here for continuity:

## Goal

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
3. Selects initial objects and components near or visible from the spawn.
4. Downloads all selected assets.
5. Parses and installs those assets and components.
6. Activates the hosted world and presence.
7. Compiles all render pipelines and warms up the GPU.
8. Returns from `App.init()`.

Only then does `src/main.js` hide the loading screen and start the render loop.
The player’s spawn pose is known earlier, but the player cannot be seen or move
until the later gates complete.

The current startup does not always download every manifest asset: the initial
asset ID filter limits the request set. However, it still has several sources of
unnecessary delay:

- startup allows selected assets through `background` priority;
- objects and components without `streamingBounds` are selected immediately;
- large monolithic assets, such as terrain packages, cannot be partially
  downloaded;
- component installation can perform expensive decoding or runtime setup;
- full shader precompilation and GPU warmup happen before rendering starts.

## Entry-ready phase

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

## Progressive phase

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

## Shader startup

Move full shader precompilation and GPU warmup out of the critical entry gate.
Compile only the minimum pipelines needed by the bootstrap scene before the
first frame. Compile remaining variants and perform additional warmup while the
player is already in the world. A first-use stall must be handled by the
progressive loading state rather than preventing all entry.

## Asset-format limitation

Priority labels cannot interrupt one large asset download. Truly early entry
for large worlds requires spatially chunked terrain/structure assets or a small
bootstrap collision/visual representation followed by detailed chunks. Treat
this as a packaging/content-streaming requirement, not only a client scheduler
change.

## Portal behavior

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

## Acceptance checks

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
