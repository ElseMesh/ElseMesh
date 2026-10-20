# World and network design

This is the high-level design for ElseMesh worlds, the network that connects
them, and portal handover. It starts with the intended product model and then
records what the current implementation actually guarantees. The protocol
details and limits live in [world-network-protocol.md](world-network-protocol.md).

## Design goals

A ThruHold is an independently owned, signed world. Its owner publishes the
world's content, portals, and default participation policy. Clients discover a
world by stable world ID, verify the owner's signed manifest and content hashes,
then connect to the owner or an owner-authorized content provider. A provider
address is a route, not proof of ownership or permission.

The owner should be able to protect the service from resource exhaustion by
setting a maximum population and caps on the complexity of avatars, vehicles,
and carried or spawned objects. Those limits need enforcement before expensive
work is admitted, and should account for aggregate cost as well as per-entity
cost. Reasonable byte, message, request-rate, concurrency, and session limits
are part of the same boundary.

World moderation and a visitor's personal viewing choice are separate policy
layers. The owner can select which shared avatars and objects are normally
visible to visitors. Unapproved content is shared directly by the person who
created or controls it, and only visitors who opt in receive it. That choice
affects only the visitor's presentation: it does not authorize writes, increase
server capacity, bypass the owner's admission and transport limits, or make
hidden content available to everyone. A private world or access-controlled
asset still requires authorization. Clients should clearly identify when they
are viewing content outside the owner's default presentation policy.

Clients may use an owner-hosted gateway, a direct browser WebRTC data channel,
or an optional daemon-to-daemon ZeroTier/libp2p path. Gateways provide
signaling and compatibility fallback. Direct connections are optimizations,
not authority. Every path must preserve the same world identity, owner
authorization, bounded request handling, and signed content checks.

### Neighboring-world redundancy

A world owner should be able to nominate neighboring world operators as
redundant providers for this world, with an explicit preference order. A
neighbor participates only after the owner grants its daemon the relevant
hosting scopes and it has the required signed package data. If the owner is
unavailable, the system should select the first eligible provider in
owner-defined order, verify the unchanged owner-signed manifest and asset
hashes, and return authority to the owner when it recovers. Each configured
standby receives every committed simulation update; an update is committed
only after all configured standbys acknowledge it. A shared, heartbeat-driven,
expiring authority lease with fencing prevents two servers from simulating the
world at once. When the owner returns, it synchronizes the latest committed
state and reclaims authority promptly with a higher fencing epoch. A preference
list expresses failover order; it does not transfer world ownership or permit
a neighbor to rewrite the owner's signed source.

Serving static content and becoming the live world authority are separate
permissions. The current delegated failover lease can temporarily make an
authorized delegate discoverable and allow it to serve the owner's manifest;
`content-cache` is separately required to serve assets. Current delegation does
not replicate live presence, simulation, or shared state. The ranked, fully
replicated standby and fenced authority model above is a design requirement,
not a current capability.

If no authorized provider has the latest acknowledged state, the world becomes
read-only. Visitors may still move locally and traverse signed portals whose
destinations are available. They do not publish presence or commit gameplay
changes in that read-only world. A destination with an active authority may
accept normal play; otherwise the visitor continues in read-only mode.

## World and portal lifecycle

World content is authored as editable source, converted to a deterministic
content-addressed package, reviewed, and published by its owner. The signed
manifest identifies world rules, assets, components, portal destinations, and
the owner. See [world authoring](world-authoring.md) and [owner publication](account-roles.md#owner-publication).

A portal is a signed route in its source world. The source owner defines its
entry frame, destination world, destination exit frame, preview choice, and
optional provider/gateway hints. Portal links are unsigned authoring documents;
they help two owners create complementary doorway records but do not grant
access or synchronize future edits. Each owner publishes their own route.

When a visitor approaches a portal, the client resolves the destination,
verifies its signed manifest, and prepares the prioritized preview and visible
content. A preview is read-only: it must not create a destination presence
session or publish the visitor's pose. The visitor is held at the threshold
until required content is ready. On crossing, the client maps position,
orientation, and velocity through the two portal frames, switches active world
and transport session, and releases the source world resources. If the
destination accepts the current bundled boat and its declared limits are met,
boat state is mapped and transferred with a destination speed cap. Otherwise
the visitor remains on the source side.

### Invitation-gated entry

World owners may opt into invitation admission. A visitor opens an
`elsemesh.org/invite/<code>` URL; the main ElseMesh service validates the
invitation and the approved identity, then redirects with a short-lived opaque
launch grant. The destination gateway exchanges that grant for a signed,
world-bound admission assertion before accepting the browser connection.

ZeroTier node ID is the first reusable stable identity. An invitation without a
provable static identity is single-use. Reuse, inactivity expiry, revocation,
and replay protection are enforced by durable admission state. Existing worlds
remain guest-readable unless their signed access policy requires invitations.
The invitation is separate from account roles and does not replace owner-signed
manifest/provider validation.

### Readiness and light continuity

The signed world experience may specify the minimum bootstrap, visible,
collision, spawn, lighting, and simulation content needed before the client
shows the first frame. Portal sides may specify a smaller preview set and a
crossing set. The client loads those sets first, holds the visitor at the
threshold until crossing requirements are ready, and continues view- and
distance-prioritized streaming afterward. A remote launch should not build the
entire procedural Example Island before activating the selected world.

Portal lighting is a dynamic result of the destination scene currently
available to the visitor. As the visitor approaches, prioritize the structures,
surfaces, textures, lights, and other objects nearest to and visible through
the aperture, using progressive arrival similar to Second Life. Bootstrap the
destination's global environment and dominant light sources too, because a
distant sun, sky, or emissive object may illuminate the doorway without
appearing through the aperture. The portal may show a provisional result and
refine its lighting as destination data arrives.
Apply the contribution only around the doorway and cap its cost and intensity.
Incomplete destination data must not be represented as final lighting. Full
cross-world global illumination and shadow transport are deferred.

### Carried and detached objects

Objects an avatar carries are owned by that user. The world owner defines
policies per object type: whether it can be put down or thrown, what happens
when its user leaves, whether detached objects persist, how long an unclaimed
object remains available, and whether users may transfer objects to each
other. A drop can preserve the current owner's claim, release the object for
others to claim, or remove it, according to that policy. The world server
authoritatively assigns ownership and simulates any permitted throwing; a
client cannot create ownership by assertion.

Ownership may be session-bound or persistent, as selected by each world.
Persistent ownership requires a stable user identity across reconnection. A
world may release an object as claimable when its user leaves; if no one claims
it before the owner-defined claim window expires, the world prunes it. Worlds
may instead remove it or retain it under their configured persistence rules.
Enabled user-to-user transfers require both users' consent and an atomic,
server-validated item-for-item exchange.

At a portal, carried objects transfer only if the destination permits them and
has capacity. If it rejects an object, the visitor waits at the threshold and
can drop or trade the object before trying again. The handoff must not leave a
duplicate or lose ownership when either world disconnects during the transfer.

These policies are design requirements. ElseMesh currently has static,
owner-authored world objects, not a general runtime object inventory, loose
object, ownership, or transfer protocol.

## Security and denial-of-service model

Treat every browser and peer as untrusted. Parse bounded messages, validate
world and request IDs, reject stale presence sequences, bind transient player
identity on the server, and apply per-connection/per-peer throttles. Apply
limits at the owner, where admission and live presence authority reside. Cache
providers may serve authorized immutable content but do not gain live presence
authority merely by caching it. A compromised or abusive client must not be
able to claim another identity, inject executable content, or turn a personal
display override into authority over other visitors.

No client-side cap can force a malicious client to render cheaply. The owner
can bound admitted live participants and validate declared behavior; each
viewer must independently cap local rendering and downloads. Strong global
limits on carried objects require an authoritative object/inventory protocol;
the current presence protocol does not contain one.

## What the code supports today

- Owner-signed manifests and hash-verified world assets, with bounded manifest
  counts and optional signed aggregate package-byte limits.
- Owner-hosted presence with at most 128 live player records per world, a 20 Hz
  update ceiling per active record, increasing sequences, and a 10 second
  expiry. Browser clients normally send at 10 Hz.
- A signed `avatarComplexity` value applied by the browser to remote-avatar
  mesh selection. It caps triangles per remote avatar, not total world cost.
- A bundled Downeast boat contract. The destination can opt in, require a
  compatible boat component/berth, cap speed, and cap avatar-plus-boat triangle
  complexity. The owner validates presence reports and portal preparation also
  checks locally.
- Signed front/back portal route data and client-side preview, preparation,
  pose mapping, and world switch. See [portal authoring](portal-authoring.md).
- WebSocket/WebTransport gateway requests, optional direct WebRTC requests,
  and optional daemon ZeroTier/libp2p transport. Owner presence remains the
  authority; cache replicas reject presence writes.
- Owner-signed hosting grants can authorize `content-cache` and/or bounded
  `failover-authority` for up to 256 provider nodes. Delegated authority windows
  cannot overlap. Directory lookup ranks a recovered owner first, active
  delegates second, and cache providers third; within a tier it uses PeerID as
  a stable tie-breaker.

## Current gaps and mismatches

1. **Population limit is fixed, not owner-configurable.** The daemon currently
   hard-codes 128 presence records. There is no signed world-level player cap,
   nor a separate gateway-wide admission budget keyed across all gateways.
2. **Avatar complexity is per entity and viewer-enforced.** The world owner
   sets a triangle cap, but the server does not inspect a client's actual mesh
   or enforce aggregate visible triangle cost. A client can ignore the cap.
3. **Vehicle support is narrow.** Only the bundled Downeast boat has a declared
   46,845-triangle contract. Carried objects, arbitrary vehicles, inventory,
   object ownership, and server-authoritative object simulation are not
   represented by the presence protocol. World-owner policies for dropping,
   throwing, persistence, claims, disconnect handling, and transfers are
   design requirements, not runtime features.
4. **No owner moderation list or personal override exists yet.** Presence
   snapshots currently go to all participants of that world connection, and
   there is no policy for selective avatar/object visibility or direct
   client-to-client content sharing. Thus the requested presentation override
   cannot currently be implemented as a preference toggle. It must not be
   confused with bypassing access control.
5. **Handover is client-coordinated, not transactional.** The client prepares
   and verifies the destination before switching, but persistent account
   identity, inventory, arbitrary carried objects, authoritative simulation
   continuity, and an atomic source-leave/destination-join protocol do not
   transfer today. The design requires destination policy and capacity checks,
   a wait-at-threshold path for rejected objects, and duplicate-safe ownership
   transfer. A disconnect during the current transition can leave only TTL
   cleanup at the source.
6. **Neighbor preference order is not owner-configurable yet.** The code has
   ordered provider pairs in invite URLs and tiered directory selection, but
   the signed hosting grants do not record an owner-selected ranking among
   neighboring worlds. Current order within the delegate tier is a PeerID
   tie-break, not the owner's preference. A topology-aware, ranked neighbor
   failover list is therefore a design requirement, not an implemented policy.
7. **Direct browser networking is not universally reachable.** WebRTC has a
   tested local path and gateway fallback; cross-NAT public connectivity and
   TURN are outstanding. Browser-hosted owners still require the gateway path.
8. **Read-only failover traversal is not implemented.** The client has no
   read-only world mode that permits local movement and signed-portal traversal
   while suppressing presence and gameplay writes.
9. **Synchronous simulation standby is not implemented.** Current failover
   grants preserve bounded manifest authority and content delivery only. There
   is no replication of committed simulation state, all-standby acknowledgement,
   shared heartbeat lease, fencing epoch transition, or owner recovery sync.

These gaps mean current caps reduce accidental overload and bound several
protocol paths, but do not yet constitute comprehensive DoS resistance or the
requested owner-versus-personal moderation model.
