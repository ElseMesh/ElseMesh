# ElseMesh goal and acceptance index

Implement and verify the agreed decentralized ElseMesh multi-world system in
the main branch. This file is the short, durable acceptance contract. Detailed
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
