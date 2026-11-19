# World and network protocol design

This low-level companion describes current wire and runtime behavior, with
recommended extensions clearly separated from implemented protocol. The
high-level model is in [world-network-design.md](world-network-design.md).

For external design references, see
[Second Life streaming references](secondlife-streaming-references.md). Those
native projects inform queueing, caching, range requests, and LOD policy only;
ElseMesh rendering remains browser-side WebGL/WebGPU.

## Identity and trust boundaries

- `worldId` is the stable `elsemesh:...` identifier. The owner's signed
  manifest is the authority for world content and rules.
- For provider discovery, the stable ElseMesh HostID is the owner's profile
  PeerID derived from `node.key`, bound to `worldId` by a signed host/session
  advertisement. Keep ElseMesh HostID distinct from ZeroTier Host ID (called
  NodeID in its API/config) and network ID;
  ZeroTier roots provide overlay path discovery, not ElseMesh world
  registration or membership authorization. When `worldd` is configured for
  ZeroTier, ztlib identifies the server node by default; this does not prove a
  visitor's identity. A verified client integration may provide the visitor's
  authenticated NodeID for association with a world-local player record.
  Browser hosts can advertise
  the same HostID through their gateway without a ZeroTier client. IRC may be
  evaluated as a separate discovery lookup method, not an identity proof.
- `ownerPeerId` identifies the owner node. Optional portal peer/gateway fields
  are routing hints. Browser routes use HTTPS/WSS.
- Daemon-to-daemon world RPC streams negotiate `/elsemesh/world/3.0.0`. This
  protocol ID follows the current ElseMesh world-manifest generation; v1 stream
  peers are not negotiated as a compatibility fallback.
- Content is addressed by SHA-256; clients verify signed declarations and
  downloaded bytes. A cache provider is not thereby a world owner.
- The signed manifest may contain up to 256 host grants. Each grant names a
  PeerID, scopes (`content-cache` and/or `failover-authority`), expiry and
  epoch. Failover grants also define a bounded activation window. Windows for
  different delegates may not overlap.
- Gateway and WebTransport sessions assign a fresh random 128-bit presence
  session. The server derives the player key from its own identity plus that
  session. Browser-supplied player/session identity is overwritten.
- Presence pose and appearance are self-reported, ephemeral presentation data;
  they are not authenticated account identity or authoritative simulation.
- The desired stable visitor identity for restoring a world's saved records
  is distinct from current session-derived IDs, owner/node identities,
  invitation grants and optional accounts. It is not implemented by
  existing presence sessions.
- Worlds own their visitor presence independently. No globally exclusive
  player membership or atomic two-owner portal transaction is required.
- Existing request paths serve signed manifests, asset bytes, and data-channel
  messages. They do not discover or dynamically decode game-backed world
  regions. A game-backed provider needs a signed region descriptor, bounded
  region discovery/request/cancellation, content integrity, and memory/cache
  controls. A video/audio game-session relay would be a different protocol and
  does not meet independent multi-avatar requirements.
- Region collision is explicit data, not inferred from render meshes. The
  region loader must validate provider collision limits and register/remove
  those shapes with the active region and its instance transforms.
- Presence updates remain client-reported poses. The owner bounds horizontal
  displacement by the signed movement speed using a capped 100 ms burst credit;
  a first pose without spawn candidates must also stay within the signed spawn
  radius. These checks prevent arbitrary distant admission and repeated speed
  bursts but are not collision validation. Portal handoffs outside the spawn
  radius require an owner-verifiable handoff proof before admission. Hosts must
  reject swept paths that intersect authoritative collision before treating a
  reported position as traversable.
- Dynamic doors require an authoritative interaction request and a
  host-committed transition carrying the stable door ID, sequence/transition
  ID, start time, target state, and collision change. The same committed event
  carries the sound event ID/reference so clients animate and play the effect
  once. Current presence is self-reported pose/appearance only and cannot
  authorize a door state or sound event.

## Owner-signed browser behavior events

An experience extension reference may include an `events` array of up to 16
unique ElseMesh event IDs. The owner signature covers this subscription list.
The browser dispatches only event IDs the module declared; omitting `events`
subscribes to none. The current engine event is
`elsemesh.world.activated/1`, with a JSON payload containing `type` and
`worldId`. The module runs in its dedicated JavaScript Worker and returns a
bounded JSON result to the registered behavior adapter. App and renderer
objects never cross the Worker boundary. WebGPU and WebGL share this event
contract.

## Invitation admission and launch grants

World access may be invitation-gated independently of signed content and
provider identity checks. An owner-authorized invitation names a world and may
bind admission to a stable identity. A ZeroTier-configured `worldd` uses ztlib
for its server node identity. This does not authenticate a browser visitor;
the visitor needs their own ZeroTier client identity and proof of control. The
invitation creator need not know that Host ID in advance.
An invitation can instead require social-account authentication or act as a
single-use bearer capability.
Portals and invitation codes are alternative arrival routes: both are
subject to destination admission. A portal may admit visitors without codes
where permitted, but cannot bypass a destination's invitation requirement.

The current `?invite=` route code is a compact base64url encoding of route
query fields: canonical world ID, optional ZeroTier network ID and HostID,
optional ZeroTier private gateway plus its short-lived signed node record,
ordered PeerID/gateway candidates, and resolver origin. The browser verifies
the embedded node record against the world ID, network ID, HostID and private
gateway before making any request to that private address. If the record is
stale, the browser skips that direct attempt and resolves the HostID through
the configured directory. The browser decodes and validates the route before
constructing the normal `WorldConnector`. The compact code itself is unsigned,
unencrypted, and not a secret or admission grant; it is only a set of routing
hints. The embedded node signature binds its own advertised gateway and
ZeroTier identity against route edits, but is not an owner authorization: the
node self-asserts those fields. The browser checks the provider's owner grant
against the signed manifest after connecting and before accepting content.
The client retrieves world data from the selected provider gateway. A
future owner-signed admission ticket using `?invite=` must have a distinct
format and remain unimplemented until `worldd` verifies its player binding,
allowed identity, expiry, revocation, and replay state.

The desired public entry point is a short ElseMesh invitation URL such as
`https://elsemesh.org/?invite=<signed-ticket>` (a path-form URL may be
supported as an alias). Avoid a separate invitation lookup service: `worldd`
creates the pending world-local player record and issues a self-contained,
URL-safe ticket signed by the world owner key. The ticket binds the world ID,
owner identity, network route, a random opaque player-record reference, the
allowed sign-in methods or identities, issue/expiry times, a unique ticket ID,
and redemption policy. A 24-hour expiry should be available as a preset; the
owner may choose a shorter or longer lifetime. Signatures prevent editing the
player reference, route, or expiry. Use random record references rather than
guessable sequential player numbers, and never treat client-supplied player
numbers as authority. The ticket is signed, not secret: don't include provider
tokens, ZeroTier private keys, or other reusable credentials. The client can
parse and verify its structure locally, but `worldd` is the final validator.

For a single friend invitation that allows Facebook, Google, and Telegram,
all three verified provider identities must resolve to the same pending
world-local player. The ticket may bind the provider allowlist and opaque
identity references, but must not expose contact details. On redemption, the
selected provider must prove control of an identity explicitly authorized for
that player; merely signing in with an arbitrary account at an allowed
provider is insufficient. Treat owner-entered email addresses, phone numbers,
and profile URLs as unverified matching hints until the provider's supported
login or verification flow proves the association. In particular, do not
assume a Telegram login claim proves control of a phone number unless that
flow returns a verified phone claim. The acceptance test is one URL of the
form `https://elsemesh.org/?invite=<signed-ticket>` that opens the target
world after successful authentication with any one of the invite's verified,
allowed identities.

The owner signature binds the invite to the existing pending player record.
On connection, `worldd` verifies the signature, target world, expiry,
revocation/replay state, allowed authentication, and the record binding before
admission. It can maintain revoked ticket IDs and redeemed-ticket state in its
own database; no separate online invite service is needed. Provider login, if
required, still occurs before the world binds the player record. A self-issued
ticket is a bearer capability unless it also requires an allowed provider
identity or authenticated ZeroTier Host ID. Remove the ticket from browser
history after parsing and avoid consuming it on a link-preview GET.

The ticket must identify a route the visitor can actually reach. Prefer a
stable HTTPS/WSS gateway hostname for ordinary browsers. If its address is
dynamic, DNS must be updated or a relay must keep a stable public endpoint;
GitHub Pages cannot perform that lookup. These approaches require DNS control
or an online relay/locator service. A self-contained invite ticket is
service-free only when it contains a stable locator, not an address that may
change after issuance.

A ZeroTier ticket should carry the network ID and stable ZeroTier Host ID, not
the host's changing public/WAN IP. The Host ID lets ZeroTier's peer discovery
find the node's current underlying endpoint, but a client still needs to join
and be authorized on that network. Where the application socket API requires
a ZeroTier managed IP, the network must provide a stable managed address or
the client must obtain the current HostID-to-managed-address mapping from a
trusted network advertisement/controller. Host ID alone is not an IP route.
An ordinary browser invite resolves its world ID through the Worker and
connects directly to a provider's signed HTTPS/WSS gateway. A ZeroTier private
route is optional and only available when the visitor's host OS already
provides that route (or a future browser ZeroTier transport exists). An invite
may include a private HTTP gateway as a fallback. `worldd` publishes this
address inside its signed node record and bridges the ZeroTier TCP port to its
dynamically selected local HTTP/WebSocket gateway port. The client verifies
the node signature and checks its ZeroTier network ID, Host ID, world ID and
gateway before connecting. The Worker performs lookup only and never carries
world traffic; ordinary browser access does not require ZeroTier or a browser
ZeroTier implementation.

Hosted HTTPS pages cannot generally connect to private IPs without browser
permission. Chrome 142 and newer supports local-network requests from secure
contexts, including HTTP fetch and WebSocket URLs using private IP literals,
behind the user's Local Network Access permission. The browser must still have
the ZeroTier OS route, and `worldd` must allow the ElseMesh page origin for its
WebSocket gateway. Other browsers or denied permissions fall through to the
HTTPS/WSS provider gateway. See [Chrome Local Network Access](https://developer.chrome.com/docs/modern-web-guidance/guides/security/local-network-access).

A Tailscale MagicDNS `*.ts.net` gateway can use the secure direct-gateway slot
when the visitor's device has been connected to or shared into the relevant
tailnet. This uses the host OS Tailscale route, not a browser Tailscale
implementation. Tailscale Funnel is a separate public-exposure mode: it can
make a `.ts.net` endpoint reachable to ordinary Internet visitors, but then
ElseMesh must enforce access itself and cannot treat Tailscale identity
headers as proof of the visitor's identity.

ElseMesh already has an optional signed provider locator: `worldd` can publish
its current gateway advertisement, and the client can look it up by world ID
or ZeroTier network/node ID. This resolves a stable identity to the current
HTTPS/WSS gateway; it does not proxy world traffic or redeem invite codes.
The deployment must still provide a reachable gateway, such as a stable DNS
hostname or reverse tunnel. See [gateway resilience](gateway-resilience.md)
for its expiry, refresh and deployment behavior.

The browser verifies the owner's world manifest, then connects to the chosen
HTTPS/WSS gateway; `worldd` validates the ticket and retains final admission
authority. Ticket state and admission assertions bind the target world,
identity, audience/gateway, expiry, and replay nonce. Browser `connect`
messages carry the proof, and
the same gate applies to WebSocket, WebTransport, WebRTC, and gateway fallback
paths. A world whose signed access policy requires invitations must reject
manifest, asset, presence, and gameplay requests without a valid assertion;
direct routing URLs cannot bypass this check. Non-gated worlds retain the
existing guest-readable behavior.

### ZeroTier browser transport and invites

Direct browser access to a ZeroTier IP requires the browser's device to be a
member of that ZeroTier network. A regular web page does not join ZeroTier
merely by receiving a Host ID. The optional direct route uses the device's
existing OS route and a short-lived, signed `zeroTierGateway` address; it does
not add ZeroTier membership to the browser. Ordinary browser access must work
without this route. Issue #173 is an open question from 2022 about compiling
libzt to WASM; it contains no implementation recipe or linked working branch.
Treat a browser ZeroTier implementation as exploratory, not as a dependency.
Do not use the server's ztlib identity as the visitor's or trust a
client-supplied Host ID without proof.

Here, a **transport adapter** means the code that connects libzt's expected
UDP packet send/receive operations to browser networking APIs. WASM does not
grant raw UDP access: Emscripten documents WebRTC DataChannels and WebTransport
datagrams as alternatives, but supplies no C/C++ API for either. A DataChannel
connects to a WebRTC peer, while WebTransport connects to a server; neither
lets the browser send arbitrary UDP packets directly to ZeroTier roots and
peers. The adapter therefore needs either a protocol-aware browser transport
supported by the remote ZeroTier peers, or a reachable gateway/relay that
forwards the ZeroTier packets. That relay must be discoverable at a stable
endpoint, so it is an online dependency. This is substantial networking work,
not merely a compiler flag.

Browser-managed ZeroTier is unproven and is not part of the supported baseline.
Only investigate it if a measured user need justifies the networking and
performance work. Standard browser networking does not expose raw UDP sockets;
a WASM port would need a WebRTC or WebTransport adapter and a compatible peer
or relay. See [Emscripten networking
limits](https://emscripten.org/docs/porting/networking.html) and the open
[libzt WebAssembly investigation](https://github.com/zerotier/libzt/issues/173).
Its optional, non-blocking status is tracked in
[project direction](../PROJECT-DIRECTION.md#product-requirements). Ordinary
visitors use the signed public HTTPS/WSS gateway. An already-connected device
may use its native ZeroTier route; Tailscale Serve can provide a private
HTTPS/WSS gateway under a tailnet's `*.ts.net` name, which still requires
device-level Tailscale connectivity and acceptance of the shared host where
applicable.

Invitation codes and launch grants are capabilities, not account role grants.
They must not contain private keys or reusable account session tokens. Enforce
bounded clock skew, replay protection, rate limits, durable redemption state,
and revocation checks at the gateway and world authority.

## Trusted-neighbor identity introduction

One ElseMesh account key may have multiple separately verified sign-in methods
linked to it. For a portal crossing, the account broker issues a short-lived
authentication assertion whose audience is the destination world. With visitor
consent, it records the verified method(s) used and their authentication
time/assurance, but contains no external provider token or raw provider subject.
The source owner signs a one-time introduction binding that assertion to the
source session, source world, destination world, portal, expiry, and a unique
nonce. This statement proves provenance from a neighbor; it cannot add account
methods, roles, or permissions to the broker's assertion.

The destination accepts the handoff without another interactive login only
when its own policy trusts the source world's owner key and accepts the
assertion's account proof and authentication methods. On acceptance it creates
or updates a destination-local known-player record keyed by a pairwise subject
for that world, and records the disclosed methods and introduction provenance.
The assertion is single-use, audience-bound, expiry-checked, and replay
protected. The destination's bans, admission rules, visitor limits, and world
roles remain authoritative; trust in a neighbor conveys identity provenance,
not the neighbor's privileges. If the proof is missing, stale, or insufficient,
the destination falls back to its own guest, invitation, or login policy.

Account-linked methods are merged only after separate proof of control and
account-key authorization. Email, display name, IP address, and ZeroTier IP
must never be used to merge accounts. Use destination-specific account subjects
so a world can recognize a returning visitor without exposing a globally
correlatable identifier to every other world.

The initial invitation flow must present the visitor with the permitted
Facebook, Google, and Telegram sign-in choices. When `worldd` is configured
for ZeroTier, ZeroTier identity association is enabled by default and remains
separate from the invitation's social-provider allowlist. The owner need not
know the visitor's ZeroTier Host ID when issuing the invite. `worldd`'s ztlib
identity proves the server's network node, not the visitor's. The visitor's
Host ID may be associated with their world-local player record only after a
client-side ZeroTier integration proves control of that identity; the browser
WebAssembly path remains an unverified benchmark target described above.
This is distinct from linking the Host ID to a Facebook, Google, Telegram, or ElseMesh account,
which requires its own explicit account-linking flow. Do not infer NodeID from
an IP address or expose ZeroTier identity secrets to browser code. The exact
ztlib authentication assertion and verification boundary remain an
implementation design gate. After authentication, a
separate consent record selects at most one provider profile and link for the
public player card, or selects no public link. This choice need not be the
method used for sign-in, but any other provider identity selected must already
be verified as linked to the same ElseMesh account. The account broker keeps
the provider subjects and bearer tokens private; only the chosen display label
and profile link are sent in public presence. Trusted-neighbor introductions
carry the selected public identity only when the visitor consents and the
destination accepts it.

The visitor signs the disclosure with the account key and binds it to the
target world. This proves consent, not that a self-entered URL belongs to that
provider account; only mark a profile link provider-verified when provider
proof binds that URL to the linked identity.

Only `worldd` instances configured to use ZeroTier offer this login method.
For those instances, the authenticated ZeroTier NodeID is a
world-local player identity only after the owner associates it with a player
record. It is not an invitation-time requirement, a public social profile, or
a network IP address.

Profile-link resolution is provider-specific. Use provider-returned public
URLs when available; otherwise the visitor may enter a URL only as an
explicitly unverified custom link. Validate HTTPS and the provider's allowed
host list, display verification status, and never construct profile URLs from
email addresses or provider subjects. For example, Google People API may return
`urls[]`, Facebook's `user_link` permission has availability restrictions,
and Telegram sign-in may return a username suitable for a `t.me` link. These
values can be absent or change, so the visitor can update or withdraw them.

## Presence ghosting and world-defined simulation authority

After 10 seconds without an accepted client update, the owner includes
`ghost: true` for that visitor in presence snapshots. The avatar remains
visible but translucent and cannot obstruct movement or spawn occupancy.
The owner removes it after 120 seconds of silence. A valid update before
expiry restores opaque collidable presence; explicit `presence.leave`
removes it immediately. Unexpected connection loss is not an explicit
leave. The ghost flag comes from the authority, not a client pose.

The present basic protocol reports client-calculated pose/appearance.
This is a baseline, not the world-authority ceiling: the `worldd`
daemon must be extensible for independently authored world rules,
server-authoritative physics, movement/collision validation, gameplay
simulation, anti-cheat and owner-issued state corrections. Those richer
protocols need specific implementation and tests and are not implied by
the existing presence messages.

## Current request paths

1. Browser connects to the configured gateway and selects a world/target node.
   WebSocket or WebTransport serves the ordinary request path.
2. Optionally, the gateway forwards a bounded WebRTC offer to the selected
   target. The browser uses an ordered reliable data channel for supported
   world RPCs. If setup fails, gateway transport remains available.
3. Requests are restricted to defined RPC types and bound to the selected
   world, target, request ID, and transport session. WebRTC is opportunistic;
   local integration has passed, but cross-NAT reachability and TURN remain
   unverified.
4. Optional libp2p/ZeroTier connects daemons, including authorized content
   caches. It does not make an ordinary browser a ZeroTier participant.

Gameplay and physics run in each visitor's browser wherever practical. Presence
updates must reach the owner so other visitors can see the resulting avatar
positions and modes. The owner validates and stores the latest pose for each
active connection, then returns a sorted snapshot; receiving presence does not
make the server run that visitor's ordinary gameplay simulation. A cache or
failover provider returns `presence_owner_required` rather than becoming a
second simulation authority.

## Neighbor redundancy: current protocol and requested preference model

The current host-grant protocol already provides part of the redundancy
foundation. The owner signs grants for provider PeerIDs. `content-cache` lets a
provider preload and serve the complete hash-verified package. A separate
`failover-authority` grant allows that daemon, during its bounded owner-signed
window, to obtain a temporary authority lease and serve the unchanged
owner-signed manifest. A failover-only grant does not include package bytes;
that delegate also needs `content-cache` to serve assets. Owner recovery takes
priority over an active delegate. The delegate cannot sign a replacement world
manifest, accept edits, or take over presence/simulation authority.

Provider discovery currently orders an available owner first, active failover
delegates second, and cache providers third. PeerID is the stable tie-break
within each tier. The client can also accept up to eight explicit
`nodeId`/`gateway` pairs in invite order, then continue signed discovery and
recovery. This supports operator-curated URL order but does not encode an
owner-authored ranking in the signed manifest. It also does not associate
providers with neighboring world IDs or ensure that they are geographically or
topologically near.

The requested design is for an owner to designate neighboring worlds as
eligible replicas and publish an ordered preference list. A versioned signed
redundancy policy should bind each rank to the neighbor world ID and its
authorized hosting PeerID(s), required scopes, content revision/hash, and
bounded failover conditions. Neighbor ranking should not itself grant hosting
rights; explicit owner authorization and the existing scopes remain necessary.
Clients and directory selection should honor that order after owner failure,
while still verifying the original owner's manifest and grants.

For full simulation continuity, every configured standby synchronously
replicates the authoritative mutable state needed to resume play: presence,
vehicle and object state, inventories, and other world simulation/event state.
An action becomes committed only when every configured standby acknowledges
it. This intentionally trades write availability for consistency: if a
standby cannot acknowledge, the update is not committed. If no eligible
provider can prove it has the latest committed state, visitors enter read-only
mode rather than continuing a divergent simulation.

One shared, heartbeat-driven, expiring authority lease selects the active
simulation server. Fencing epochs prevent a former owner or delegate from
continuing to accept writes after authority changes. When the owner returns,
it first synchronizes the latest committed state from the active authority,
then reclaims authority promptly with a higher fencing epoch; the transition
must not allow owner and delegate to simulate concurrently. Owner-defined
neighbor ranking selects which eligible, state-current standby takes over.

In read-only mode, visitors may move locally and traverse any signed portal
whose destination can be resolved and prepared. Their presence and gameplay
actions are not published or committed in the read-only world. On arrival, the
destination's own authority state determines whether normal play or read-only
traversal applies. This allows visitors to reach exits toward neighboring
worlds even while their current world lacks a safe writable authority.

This is not a blanket claim that the current system implements neighbor-ranked
redundancy. Current grants authorize provider nodes and current discovery
orders by role tier, with PeerID ties. The owner-configurable neighbor ranking
is missing. Also missing is failover of live presence, simulation state, or
write authority; the current leases only preserve bounded manifest authority,
and cached content can preserve package delivery. The ranked neighbor policy,
all-standby synchronous state replication, shared heartbeat lease, fencing,
owner resynchronization, and read-only portal traversal are future behavior.

## Current presence limits and checks

The presence protocol is `elsemesh.player-presence/4`; other protocol versions
are rejected. A pose includes monotonic per-session sequence, bounded
position/orientation, mode, avatar profile identity, appearance, optional
world-authored entry and avatar-option IDs, and optional vehicle type and
speed. The owner requires an entry-point ID when the signed manifest declares
entry points and an avatar-option ID when it declares avatar options. It
validates the selected IDs and palette against the signed manifest and keeps
that selection fixed for the presence session. Position is limited to ±100,000
m; yaw to ±1,000 radians; pitch to ±1.5 radians. Appearance is selected from
built-in male/female styles and four hex colors; no arbitrary URLs, shaders, or
executable code are accepted.

The owner holds at most 128 players per world. Existing records may update at
most once per 50 ms (20 Hz); stale/decreasing sequences fail. Records expire
after ten seconds without an accepted update. Browser publishing runs at 10 Hz
with one update request in flight. Closing a connection sends leave when
possible; TTL handles abrupt loss. These limits are process/world-local and do
not create an aggregate cap across a fleet of gateways or worlds.

World rules also require `maxVisitors` and horizontal `spawnRadius`.
The daemon applies the per-world visitor limit during the first presence update.
Invitation entry supplies a bounded, nearest-first `spawnCandidates` list in
that request; each feet position must be finite, within the signed radius, and
ordered by horizontal distance from the preferred spawn. Under the owner lock,
the daemon selects the first candidate that does not overlap another visitor,
or rejects admission if none is available. The browser derives candidates from
the signed world collision package and omits positions intersecting colliders.
This validates placement against honest clients and prevents concurrent player
overlap; presence remains client-reported and is not authoritative movement or
anti-cheat. Portal arrivals omit spawn candidates to preserve their mapped
pose, but still pass through the destination capacity check. Missing owner
admission or a full spawn area fails closed.

The world rule `avatarComplexity` is validated within 1–100,000 triangles and
is passed to the browser remote-avatar loader, which selects available meshes
under the cap and falls back to a simple avatar. It is not checked against
client-provided geometry because clients do not send geometry. It does not
limit the number of render instances beyond the 128-record server ceiling and
does not sum avatar costs into an owner-enforced aggregate budget.

Vehicle pose is accepted only for the bundled boat/deck modes, only when the
signed world enables `vehiclePolicy`, includes a compatible
`elsemesh.downeast-boat/1` component and supplies valid maximum speed and
combined complexity limits. The server uses the fixed 46,845-triangle boat
contract and checks `avatarComplexity + boat triangles` against the signed
maximum. The browser additionally checks destination policy before a portal
crossing and applies the speed cap. This validates presence claims; it does not
make boat physics authoritative. Presence carries the stable `avatarProfileId`
derived from the validated appearance style. Vehicle modes carry the stable
component `vehicleType`. Signed `avatarPolicy.allowedProfiles` can restrict
which profile IDs may enter, and `vehiclePolicy.allowedCombinations` can
restrict exact avatar/vehicle pairs. The owner repeats these checks during
presence admission, and the browser applies them before showing a portal view
or completing handoff. The current runtime implements only the two stock
avatar profiles and `elsemesh.downeast-boat/1`; other IDs cannot be selected or
simulated until a world package and engine runtime register them.

Other bounded inputs include 128 KiB WebSocket messages, WebRTC session and
in-flight RPC ceilings, bounded package/asset declarations, manifest entity
counts, and bounded asset streaming concurrency. Refer to
[direct WebRTC](browser-direct-webrtc.md), [world authoring](world-authoring.md),
and [player presence](player-presence.md) for the implementation-specific
details.

## Portal handover sequence in the client

1. Select the signed route matching the side of the portal plane. Front and
   optional back routes have distinct destination records; the back requires
   `elsemesh.portal-two-sided/1`.
2. Resolve the destination by world ID (or validate the pinned provider), fetch
   and verify its owner-signed manifest, then stage `portal-preview` and
   `visible` assets. A reused source-world gateway is only a route/discovery
   service unless it is also authorized to serve the destination world. Abort
   preparation if the portal is no longer selected. The source route must name
   a destination portal ID and side; that signed destination route must point
   back to this route, and the ratios must be reciprocal. Missing or mismatched
   agreement means no preview and no crossing.
3. Render a read-only view of the destination when requested and prepared. Do
   not start destination presence while the visitor is only looking through it.
4. Hold the player at the source threshold until destination content is ready.
   For a boat, check destination opt-in, component/berth compatibility, and
   combined complexity; hold at the threshold if any check fails.
5. Map position, velocity, yaw, and pitch through source entry and destination
   exit frames. `scaleRatio` is destination units per source unit (default `1`);
   apply it to offsets from the entry frame and linear velocity. Rotate
   orientation and angular velocity without scaling. The ratio must be
   positive, finite, and have a finite reciprocal; mapped positions must remain
   within the existing world-presence bounds. Author the reciprocal on a
   complementary route. The destination's own avatar/vehicle profiles define
   body dimensions and movement limits after arrival. For a supported boat
   transfer, map boat pose and linear momentum by the ratio, preserve angular
   velocity magnitude, and apply the destination speed limit.
6. Deactivate source hosted simulation/resources, switch active world root,
   collision set, connector, and signed movement rules; activate destination
   world and presence session, append lower priority content, and close the
   source connector. The URL/history is updated for the destination.

## Readiness contracts and portal light bridges

Signed world experience metadata may declare a readiness contract containing
bootstrap assets/components, the minimum visible set, required collision,
spawn, lighting, and simulation state, and per-portal view and crossing
requirements. The client should release the loading screen after that contract
is satisfied, then stream nearby and background content according to view,
distance, bandwidth, and cancellation priority. Remote launches should
initialize shared engine services without constructing the full built-in
Example Island first.

Portal lighting is not a separately published portal-side record. It is a
dynamic result of the destination scene currently available to the client. As
the visitor approaches, prioritize structures, surfaces, textures, lights, and
other objects nearest to and visible through the aperture, using progressive
arrival similar to Second Life. Bootstrap the destination's global environment
and dominant light sources too: a distant sun, sky, or emissive object can
illuminate the doorway without appearing through the aperture. Render a
portal view from the destination data currently available, then refine its
lighting as higher-priority destination data arrives. Apply the contribution only in a
portal-local volume and cap its cost and intensity. When the scene is
incomplete, use provisional or neutral lighting rather than presenting it as
final. Full cross-world shadow maps and global-illumination transfer are
deferred.

The handover is intentionally client-coordinated rather than an atomic
two-owner transaction. The client starts destination presence and sends a
best-effort source leave; the source expires silent sessions with its own
timeout. A shorter portal-adjacent timeout could improve cleanup, but merely
standing near a portal is not proof of departure. Neither a signed
source/destination commit receipt nor a frozen source pending remote
acknowledgement is required. Persistent inventories, scores, ownership and
gameplay state do not travel through portals: they are **world-local**.
A stable visitor identity is separately desired to restore a given world's
own saved records on return. See
[visitor identity and world-local state](visitor-identity-and-world-state.md).

The desired read-only failover path uses the last verified, fully acknowledged
world state as a static baseline. The visitor's avatar may move locally and
cross a signed portal after its destination is resolved and prepared, but the
read-only world does not publish that avatar's presence or accept gameplay
mutations. Each destination independently determines whether the visitor can
join writable simulation or remains in read-only traversal mode. This fallback
does not claim that presence or gameplay state has transferred.

## Desired policy extension: moderation and personal view

The desired model needs explicit separation between **admission**, **sharing**,
and **presentation**:

1. **Admission policy (owner enforced):** signed limits for population,
   per-avatar complexity, aggregate participant/triangle budget, allowed
   entity kinds, per-vehicle limits, carried-object count/complexity/bytes, and
   request/connection budgets. The owner must reject new sessions or updates
   before allocating unbounded state. A user override cannot change this layer.
2. **Sharing/moderation policy (owner default):** a signed allowlist/catalog of
   approved avatar and object definitions, plus rules for the normal visibility
   of approved content. Unapproved content is not broadcast by default;
   only the content creator/controller can share it directly, and only to
   visitors who opt in. References must be content hashes and versioned data
   contracts, never executable scripts or arbitrary URLs.
3. **Personal presentation preference (visitor local):** each visitor may
   choose to render compatible content that its creator/controller shares
   directly with them, even if it is outside the owner's default moderation
   list. Only opted-in viewers receive the unapproved content. The preference
   is local and per-world. It does not publish a policy change, increase
   admission limits, permit unauthorized downloads, or alter what other
   visitors see.
4. **Direct sharing:** share content directly from the person who created or
   controls it, after recipient opt-in. Use bounded data channels, size/rate
   limits, content type allowlists, hash verification, and short-lived routing.
   Do not use direct sharing to relay world writes or evade owner-side session
   and network quotas. A visitor can disable direct sharing.

Gameplay-affecting carried objects require world-server authority. A visitor's
direct presentation sharing does not grant an object write, ownership, or
simulation right; object state that changes the shared world must be validated
and committed by its authoritative world server.

Protocol extension should version these settings in the signed manifest and
define whether moderation applies to the sender, receiver, or public world
state. The current protocol has no moderation fields, object-sharing messages,
visitor override signal, direct client-to-client negotiation, or owner-configured
population cap. Do not imply these features exist until a versioned contract,
server enforcement, client controls, and tests land together.

## DoS hardening requirements for future versions

- Make the player cap owner-configurable but clamp it to an implementation
  maximum; enforce it atomically at the owner across all ingress transports.
- Add per-IP/peer/account handshake and failed-auth throttles, bounded pending
  sessions, global and per-world RPC budgets, connection idle timeouts, and
  bounded response sizes. Avoid trusting IP alone for identity.
- Set aggregate budgets: maximum active avatars, total avatar triangles, total
  vehicle/object complexity, carried entity count, and per-session bytes. Check
  admission before generating snapshots or allocating/rendering content.
- Bound each snapshot by count and serialized bytes. Paginate or spatially
  filter if higher population limits are later supported.
- Treat claimed client complexity as advisory. Only allow server-known,
  content-addressed definitions with measured metadata or server-side
  simulation rules; do not accept client-supplied complexity claims as proof.
- Define overload behavior (reject new join, shed stale/low-priority updates,
  or reduce snapshot detail) and make it deterministic and observable without
  logging credentials or private payloads.
- Test exhaustion and recovery on every gateway and owner path, including
  simultaneous joins through distinct gateways and cache-provider rejection.
