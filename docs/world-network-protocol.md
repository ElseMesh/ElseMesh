# World and network protocol design

This low-level companion describes current wire and runtime behavior, with
recommended extensions clearly separated from implemented protocol. The
high-level model is in [world-network-design.md](world-network-design.md).

## Identity and trust boundaries

- `worldId` is the stable `tw-world:...` identifier. The owner's signed
  manifest is the authority for world content and rules.
- `ownerPeerId` identifies the owner node. Optional portal peer/gateway fields
  are routing hints. Browser routes use HTTPS/WSS.
- Content is addressed by SHA-256; clients verify signed declarations and
  downloaded bytes. A cache provider is not thereby a world owner.
- Gateway and WebTransport sessions assign a fresh random 128-bit presence
  session. The server derives the player key from its own identity plus that
  session. Browser-supplied player/session identity is overwritten.
- Presence pose and appearance are self-reported, ephemeral presentation data;
  they are not authenticated account identity or authoritative simulation.

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

The sequence is currently coordinated in the browser. It is not an atomic
server transaction. Account identity, inventory, arbitrary carried objects,
and authoritative simulation continuity are outside the current handover.

## Desired policy extension: moderation and personal view

The desired model needs explicit separation between **admission**, **sharing**,
and **presentation**:

1. **Admission policy (owner enforced):** signed limits for population,
   per-avatar complexity, aggregate participant/triangle budget, allowed
   entity kinds, per-vehicle limits, carried-object count/complexity/bytes, and
   request/connection budgets. The owner must reject new sessions or updates
   before allocating unbounded state. A user override cannot change this layer.
2. **Sharing/moderation policy (owner default):** a signed allowlist/catalog of
   approved avatar and object definitions, plus rules for whether visitor
   content is visible to others by default. References must be content hashes
   and versioned data contracts, never executable scripts or arbitrary URLs.
3. **Personal presentation preference (visitor local):** each visitor may
   choose to render compatible content shared by another participant even if
   it is outside the owner's default moderation list. The preference is local
   and per-world. It does not publish a policy change, increase admission
   limits, permit content download the visitor is not authorized to access, or
   alter what other visitors see.
4. **Direct sharing:** if visitors exchange content directly, use a negotiated,
   bounded data channel with explicit recipient consent, size/rate limits,
   content type allowlists, hash verification, and short-lived routing. Do not
   use direct sharing to relay writes to the world or evade owner-side session
   and network quotas. A visitor should be able to disable direct sharing.

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
