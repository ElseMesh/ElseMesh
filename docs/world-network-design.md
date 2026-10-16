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
visible to visitors. An individual visitor may opt into a less restricted view,
including content other people deliberately share directly with them. That
choice affects only that visitor's presentation: it does not authorize writes,
increase server capacity, bypass the owner's admission and transport limits, or
make hidden content available to everyone. A private world or access-controlled
asset still requires authorization. Clients should clearly identify when they
are viewing content outside the owner's default presentation policy.

Clients may use an owner-hosted gateway, a direct browser WebRTC data channel,
or an optional daemon-to-daemon ZeroTier/libp2p path. Gateways provide
signaling and compatibility fallback. Direct connections are optimizations,
not authority. Every path must preserve the same world identity, owner
authorization, bounded request handling, and signed content checks.

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
   represented by the presence protocol.
4. **No owner moderation list or personal override exists yet.** Presence
   snapshots currently go to all participants of that world connection, and
   there is no policy for selective avatar/object visibility or direct
   client-to-client content sharing. Thus the requested presentation override
   cannot currently be implemented as a preference toggle. It must not be
   confused with bypassing access control.
5. **Handover is client-coordinated, not transactional.** The client prepares
   and verifies the destination before switching, but persistent account
   identity, inventory, authoritative simulation continuity, and an atomic
   source-leave/destination-join protocol do not transfer. A disconnect during
   the transition can leave only TTL cleanup at the source.
6. **Direct browser networking is not universally reachable.** WebRTC has a
   tested local path and gateway fallback; cross-NAT public connectivity and
   TURN are outstanding. Browser-hosted owners still require the gateway path.

These gaps mean current caps reduce accidental overload and bound several
protocol paths, but do not yet constitute comprehensive DoS resistance or the
requested owner-versus-personal moderation model.
