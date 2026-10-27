# World and network protocol design

This low-level companion describes current wire and runtime behavior, with
recommended extensions clearly separated from implemented protocol. The
high-level model is in [world-network-design.md](world-network-design.md).

For external design references, see
[Second Life streaming references](secondlife-streaming-references.md). Those
native projects inform queueing, caching, range requests, and LOD policy only;
ElseMesh rendering remains browser-side WebGL/WebGPU.

## Identity and trust boundaries

- `worldId` is the stable `tw-world:...` identifier. The owner's signed
  manifest is the authority for world content and rules.
- For provider discovery, the stable ElseMesh HostID is the owner's profile
  PeerID derived from `node.key`, bound to `worldId` by a signed host/session
  advertisement. Keep HostID distinct from ZeroTier NodeID and network ID;
  ZeroTier roots provide overlay path discovery, not ElseMesh world
  registration or membership authorization. Browser hosts can advertise the
  same HostID through their gateway without a ZeroTier client.
- `ownerPeerId` identifies the owner node. Optional portal peer/gateway fields
  are routing hints. Browser routes use HTTPS/WSS.
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
- Existing request paths serve signed manifests, asset bytes, and data-channel
  messages. They do not discover or dynamically decode game-backed world
  regions. The Hogwarts target needs a signed region provider descriptor,
  bounded region discovery/request/cancellation, content integrity, and
  memory/cache controls. A video/audio game-session relay would be a different
  protocol and does not meet independent multi-avatar requirements.
- Region collision is explicit data, not inferred from render meshes. The
  Hogwarts bridge serializes Unreal BodySetup primitives and convex points;
  a future region loader must validate limits and register/remove those shapes
  with the active region and its instance transforms.
- Dynamic doors require an authoritative interaction request and a
  host-committed transition carrying the stable door ID, sequence/transition
  ID, start time, target state, and collision change. The same committed event
  carries the sound event ID/reference so clients animate and play the effect
  once. Current presence is self-reported pose/appearance only and cannot
  authorize a door state or sound event.

## Invitation admission and launch grants

World access may be invitation-gated independently of signed content and
provider identity checks. An owner-authorized invitation names a world and may
bind admission to a stable identity. ZeroTier node ID is the first supported
reusable identity; the contract is extensible to other static identities. An
invitation with no identity that can be proven by the client is single-use.

The public entry point is an ElseMesh invitation URL such as
`https://elsemesh.org/invite/<code>`. The main ElseMesh service validates the
code, identity, expiry, inactivity timeout, revocation state, and redemption
limits. It then returns a short-lived opaque launch grant. The browser removes
the invitation code and grant from its URL/history after handoff.

The destination gateway exchanges the launch grant for a signed admission
assertion bound to the target world, redemption, identity, audience/gateway,
expiry, and replay nonce. Browser `connect` messages carry that assertion, and
the same gate applies to WebSocket, WebTransport, WebRTC, and gateway fallback
paths. A world whose signed access policy requires invitations must reject
manifest, asset, presence, and gameplay requests without a valid assertion;
direct routing URLs cannot bypass this check. Non-gated worlds retain the
existing guest-readable behavior.

Invitation codes and launch grants are capabilities, not account role grants.
They must not contain private keys or reusable account session tokens. Enforce
bounded clock skew, replay protection, rate limits, durable redemption state,
and revocation checks at the admission service and world authority.

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

Presence updates must reach the owner. The owner validates and stores the
latest pose for each active connection, then returns a sorted snapshot. A cache
or failover provider returns `presence_owner_required` rather than becoming a
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

The presence protocol is `elsemesh.player-presence/2` (legacy `/1` accepted for
non-vehicle poses). A pose includes monotonic per-session sequence, bounded
position/orientation, mode, appearance and optional vehicle speed. Position is
limited to ±100,000 m; yaw to ±1,000 radians; pitch to ±1.5 radians. Appearance
is selected from built-in male/female styles and four hex colors; no arbitrary
URLs, shaders, or executable code are accepted.

The owner holds at most 128 players per world. Existing records may update at
most once per 50 ms (20 Hz); stale/decreasing sequences fail. Records expire
after ten seconds without an accepted update. Browser publishing runs at 10 Hz
with one update request in flight. Closing a connection sends leave when
possible; TTL handles abrupt loss. These limits are process/world-local and do
not create an aggregate cap across a fleet of gateways or worlds.

Version-2 world rules also require `maxVisitors` and horizontal `spawnRadius`.
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
`tidewater.downeast-boat/1` component and supplies valid maximum speed and
combined complexity limits. The server uses the fixed 46,845-triangle boat
contract and checks `avatarComplexity + boat triangles` against the signed
maximum. The browser additionally checks destination policy before a portal
crossing and applies the speed cap. This validates presence claims; it does not
make boat physics authoritative.

Other bounded inputs include 128 KiB WebSocket messages, WebRTC session and
in-flight RPC ceilings, bounded package/asset declarations, manifest entity
counts, and bounded asset streaming concurrency. Refer to
[direct WebRTC](browser-direct-webrtc.md), [world authoring](world-authoring.md),
and [player presence](player-presence.md) for the implementation-specific
details.

## Portal handover sequence in the client

1. Select the signed route matching the side of the portal plane. Front and
   optional back routes have distinct destination records; the back requires
   `tidewater.portal-two-sided/1`.
2. Resolve the destination by world ID (or validate the pinned provider), fetch
   and verify its owner-signed manifest, then stage `portal-preview` and
   `visible` assets. Abort preparation if the portal is no longer selected.
3. Render a read-only static preview when requested and prepared. Do not start
   destination presence during preview.
4. Hold the player at the source threshold until destination content is ready.
   For a boat, check destination opt-in, component/berth compatibility, and
   combined complexity; hold at the threshold if any check fails.
5. Map position, velocity, yaw, and pitch through source entry and destination
   exit frames. For a supported boat transfer, map boat pose and momentum and
   apply the destination speed limit.
6. Deactivate source hosted simulation/resources, switch active world root,
   collision set, connector, and signed movement rules; activate destination
   world and presence session, append lower priority content, and close the
   source connector. The URL/history is updated for the destination.

## Readiness contracts and portal light bridges

Signed world experience metadata may declare a readiness contract containing
bootstrap assets/components, the minimum visible set, required collision,
spawn, lighting, and simulation state, and per-portal preview and crossing
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
provisional portal view from the data available so far, then refine its lighting
as higher-priority destination data arrives. Apply the contribution only in a
portal-local volume and cap its cost and intensity. When the scene is
incomplete, use provisional or neutral lighting rather than presenting it as
final. Full cross-world shadow maps and global-illumination transfer are
deferred.

The sequence is currently coordinated in the browser. It is not an atomic
server transaction. Account identity, inventory, arbitrary carried objects,
and authoritative simulation continuity are outside the current handover.

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
