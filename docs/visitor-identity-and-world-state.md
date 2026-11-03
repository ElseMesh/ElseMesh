# Visitor identity and world-local state

This is ElseMesh's **intended product model**, not a claim that all of its
capabilities are implemented. See [player presence](player-presence.md),
[network protocol](world-network-protocol.md) and
[network design](world-network-design.md) for current behavior and gaps.

## Independent world authority

Every ThruHold has an independently operated authority. Its owner decides who
may enter, how visitor presence is represented, which avatars and vehicles are
accepted, what content is moderated, and what world-local gameplay state is
stored. Worlds may define their own scores, inventory, progression, rules and
other per-visitor data, with no requirement that their semantics match those
of any other world.

A world does not need to agree with another world about which world a player
is currently "in". ElseMesh does not require globally exclusive membership,
a distributed source/destination portal commit, signed departure receipts or
a durable cross-world membership ledger. The current basic presence protocol accepts client-reported pose and
appearance; this is **not a constraint on world authority**. Each owner may
choose client-predicted physics, server-authoritative simulation, movement
and collision verification, anti-cheat, or a hybrid appropriate to its
gameplay. The `worldd` daemon must support extensible owner-controlled
simulation, state validation and correction contracts. These richer
capabilities are architectural requirements, not claims that today's
basic presence messages implement them.

## Portal and invitation arrivals

A visitor can enter a world in either of two ways:

- **Portal:** Discover and verify the destination, prepare the required scene,
  map the visitor's pose through the portal frames and request destination
  admission. Viewing through a portal does not create destination presence.
- **Invitation code:** Redeem an owner-authorized invitation through the
  intended admission service, then enter at the destination's chosen spawn.
  An ordinary world-share URL is not necessarily a redeemed invitation code.

Both routes are subject to the destination owner's access, visitor-capacity,
avatar and vehicle acceptability, complexity budgets and moderation rules. A
destination may permit entry through a portal without an invitation, or may
require invitation authorization even for portal visitors. A portal link is
never a way around an invitation-gated world's access policy. Another world's
admission decision does not bind the destination owner.

## Departure and session expiry

On a successful crossing, the client begins a new destination presence
session and stops publishing to the source. It should send an explicit source
leave where possible. If the leave is lost, the source expires the stale
session after a period without accepted presence updates; it need not ask the
destination whether the visitor arrived. A brief stale avatar or overlapping
connections can be acceptable, according to each world's own session rules.

**Two-stage inactivity lifecycle:** After **10 seconds** without an
accepted client presence update, an avatar becomes a transparent,
non-collidable **ghost**; other visitors can walk through it and it cannot
block admission/spawn occupancy. The owner retains its presence record until
**120 seconds** of silence, when it is removed. An accepted update from
the same session before expiry restores ordinary visible presence; an
explicit `presence.leave` removes it immediately. An unexpected connection
drop must not count as an intentional leave.

The authority measures time since the last accepted update; ghost state is
authoritative presentation/collision metadata, not a client-supplied claim.
A shorter timeout based on proximity to a portal is not part of this
baseline and mere proximity never proves departure. World-specific physics
may be stronger than the basic client-reported pose model, but ghosts must
remain nonblocking under those rules.

A failed destination admission may leave the visitor in the source or cause
the client to reconnect and retry. Freezing the source membership while
waiting for a remote signed commit is not a baseline requirement.

## Recognizing returning visitors

A visitor should ideally have a stable, **verifiable** identifier, such as a
public key accompanied by proof of possession, that can be recognized on a
later visit. This identifier is separate from ephemeral presence/session IDs,
world-owner identities, invitation codes and optional account login.

A world may associate its own scores, inventory, progression, permissions or
other saved records with that visitor identifier. When the visitor returns,
the world can restore **its own records**, regardless of which other worlds
were visited in the meantime. Each world chooses whether to save data and
whether concurrent sessions for the same identity are allowed. A claimed
unverified identifier must not be sufficient to retrieve private state.

**Implementation gap:** Current gateway sessions use newly generated
session-derived player IDs. They are not stable returning-visitor identities.
A general visitor-key proof and owner-side persistent record lookup/binding
contract is not yet implemented. Identity recovery, key rotation, revocation
and cross-world linkability/privacy remain design decisions. Ordinary guest
visits need not require Google account sign-in.

## State that does and does not traverse a portal

The client may map position, orientation, velocity, compatible avatar
appearance and supported vehicle pose/mode into a destination session,
subject to the destination's approval. This is navigation and presentation
context, not transfer of authoritative gameplay ownership.

Inventories, currencies, scores, quests, owned objects and progression stay
with the world that defined them. Worlds may have their own item ownership,
dropping, trading and persistence mechanics locally; there is no baseline
requirement for an atomic cross-world inventory or object exchange.

Implement additional inter-owner transactions only for a specific future
feature that demonstrably needs them.
