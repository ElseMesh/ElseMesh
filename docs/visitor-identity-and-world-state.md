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
a durable cross-world membership ledger. Accepting presence means that the
owner validates and relays a visitor's pose and appearance under local rules;
it does not mean the owner runs all player physics or provides anti-cheat.

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

The current owner presence service expires inactive records after **ten
seconds**. A future policy could use a shorter timeout when the last accepted
position was close to an active portal, but proximity is only a hint, not
proof of departure. It must not immediately eject a visitor who simply
stands next to a portal or experiences network delay. Dynamic
portal-proximity timeouts are not implemented today.

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
