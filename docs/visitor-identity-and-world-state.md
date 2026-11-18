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

ElseMesh connects these independently authored experiences into one traversable
world network. A visitor can carry a verifiable identity between worlds, but
does not carry the source world's gameplay rules or avatar selection as
authority. At the portal boundary the destination evaluates admission and
chooses the movement, interaction, simulation, and avatar-presentation rules
that apply after arrival. A destination may accept, map, or replace incoming
presentation according to its own authored policy; the owner/server enforces
that decision. A world-local choice may link appearance to permissions or
other local state, and that relationship remains explicit server-side state
rather than an inference from visible clothing.

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
visits need not require account sign-in.

## Google and Facebook visitor authentication

Visitors must be able to authenticate an ElseMesh account by signing in with
Google or Facebook. The external provider verifies control of its account;
ElseMesh maps the provider's issuer-scoped stable subject to a user-held
ElseMesh account key. Email addresses are contact attributes, never account
identifiers. The browser proves possession of that key, and the account broker
issues a short-lived, audience- and world-bound signed visitor assertion for
`worldd`. Assertions expose only the ElseMesh account identity and the
authentication status needed by the world's signed access policy; external
provider tokens and raw provider subject IDs stay between the browser and the
account broker. Provider sign-in does not grant world access by itself: the
world owner still applies invitations, visitor limits, bans and other signed
admission rules.

IP addresses are transport locators, not account identities. This includes
`localhost` and a ZeroTier virtual IP: addresses can be shared, reassigned,
proxied or changed, so `worldd` must not infer that an IP belongs to a Google
or Facebook account or use an IP match to link a person to a world owner. A
ZeroTier NodeID can authenticate a network node, but it does not establish
which person or social account is using that node. If a deployment wants to
associate a visitor account with a ZeroTier node, require independent proof of
the ElseMesh account key and of the ZeroTier node, then bind both proofs to a
short-lived world/presence session. The observed source address may help route
or rate-limit that session; it is not the proof of either identity. A local
world owner likewise authenticates as an account or owner key, not by being
`localhost`.

Guest access remains the default unless a world owner requires an authenticated
account. The current account service implements Google sign-in for role-gated
authoring actions only. Facebook login, account assertions for visitor
admission, and stable account-to-presence binding are not implemented yet.

## State that does and does not traverse a portal

The client may map position, orientation, velocity, compatible avatar
appearance and supported vehicle pose/mode into a destination session,
subject to the destination's approval and portal agreement. This is a proposed
arrival context, not transfer of authoritative gameplay ownership or source
world rules. The destination applies its own authored movement and interaction
rules immediately after admission and chooses the visitor's local avatar
appearance. If the destination links a choice such as team, class, or house to
appearance or access, its owner/server authorizes and records that linked
choice; a client cannot independently change its presentation or permissions.

Inventories, currencies, scores, quests, owned objects and progression stay
with the world that defined them. Worlds may have their own item ownership,
dropping, trading and persistence mechanics locally; there is no baseline
requirement for an atomic cross-world inventory or object exchange.

Implement additional inter-owner transactions only for a specific future
feature that demonstrably needs them.
