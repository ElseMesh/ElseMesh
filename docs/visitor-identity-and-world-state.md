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

## Owner player and invitation administration

Provide both `worldd` command-line subcommands and a small owner web interface
for player and invitation management. The CLI supports scripts and batch work;
the web interface makes routine edits discoverable. Both must call the same
validated owner operations. The web interface must be private by default:
bind its listener to loopback unless the owner explicitly enables a private
network listener, keep it separate from the public visitor gateway, and require
owner authentication even when reached through ZeroTier. Private-network
reachability alone is not proof of owner identity. Both interfaces should
support listing and showing players, creating pending player records, editing
owner-controlled fields, listing linked authentication methods, issuing invites
with an explicit provider allowlist and expiry, and revoking invites or player
access. They should offer stable opaque player IDs; the CLI should also provide
machine-readable output for automation. Sequential player numbers must not be
admission credentials.

Provider identities may be linked only after the provider login flow proves
control of the account. CLI input may select an already verified identity,
change owner-controlled metadata, or revoke a link, but typing a provider name
or account ID must never create a verified link. Store provider subjects and
verification metadata, not reusable OAuth credentials. Keep durable state in a
transactional world-local store (SQLite is the current design choice) and offer
validated human-readable export/import for review and backup; do not treat
manual edits to the live database as an administration interface. Invite
commands should print or write the signed URL only on explicit request, and
must not log bearer ticket material.

The intended command shape is along these lines; names and exact flags remain
subject to implementation:

```text
worldd player list
worldd player create --display-name "Alex"
worldd player show <player-id>
worldd player set <player-id> --display-name "Alex"
worldd player auth list <player-id>
worldd invite create --player <player-id> --provider google --provider telegram --expires-in 24h
worldd invite list --player <player-id>
worldd invite revoke <invite-id>
```

An invite may create its pending player record in one operation when a named
record is unnecessary. Owners should be able to see which providers the invite
allows and its expiry before sharing it. Neither the CLI nor the private owner
web interface is implemented yet; the examples above define the intended CLI
workflow, not currently executable options.

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

## Facebook, Google, and Telegram visitor authentication

Visitors must be able to authenticate an ElseMesh account by signing in with
Facebook, Google, or Telegram. The external provider verifies control of its
account. ElseMesh maps the provider's issuer-scoped stable subject to the
user-held ElseMesh account key. Email addresses are contact attributes, never
account identifiers. The browser proves possession of that key, and the account
broker issues a short-lived, audience- and world-bound signed visitor assertion for
`worldd`. Assertions expose only the ElseMesh account identity and the
authentication status needed by the world's signed access policy; external
provider tokens and raw provider subject IDs stay between the browser and the
account broker. Provider sign-in does not grant world access by itself: the
world owner still applies invitations, visitor limits, bans and other signed
admission rules.

IP addresses are transport locators, not account identities. This includes
`localhost` and a ZeroTier virtual IP: addresses can be shared, reassigned,
proxied or changed, so `worldd` must not infer that an IP belongs to a Facebook,
Google, or Telegram account or use an IP match to link a person to a world
owner. A ZeroTier Host ID (NodeID) identifies its authenticated ZeroTier node;
it does not by itself link to a Facebook, Google, Telegram, or ElseMesh
account. Do not infer it from the source IP. Linking it to another account
identity is a separate explicit account-linking operation. A local world owner
likewise authenticates as an account or owner key, not by being `localhost`.

Guest access remains the default unless a world owner requires an authenticated
account. The current account service implements Google sign-in for role-gated
authoring actions only. Facebook/Telegram visitor login, ZeroTier/ztlib visitor
sign-in, account assertions for visitor admission, and stable account-to-
presence binding are not implemented yet.

## ZeroTier sign-in and player association

When `worldd` is configured for ZeroTier, its ztlib network transport is
enabled by default. This identifies the server node; it does not authenticate
the visitor. For direct access to a ZeroTier IP, the visitor's device must
also join and be authorized on that same network with its own ZeroTier
identity. A browser then reaches the managed IP through the device's ZeroTier
network interface. The visitor's authenticated Host ID should be provided by
the client ZeroTier integration, not inferred from the source IP or assumed
from the server's ztlib identity. When the visitor joins, the owner can bind
that Host ID to the pending world-local player record without requiring it in
the invite. The association is stored in the world's database and can be
revoked by its owner.

The target browser path is ztlib compiled to WebAssembly, but this is not
implemented or proven. It must be benchmarked against the device's native
ZeroTier client and a public HTTPS/WSS gateway. A normal browser does not
provide raw UDP sockets; a WASM implementation likely needs a WebRTC or
WebTransport network adapter. Until that work succeeds, direct ZeroTier access
requires a device-level ZeroTier client, or the world must expose a public
gateway/tunnel/relay. **Browser WASM feasibility and performance benchmark:
0%.**

This ZeroTier player association does not automatically link Facebook, Google,
Telegram, or an ElseMesh account; those identities require their own sign-in
and explicit account-linking flow. Do not expose another user's identity
secret or ZeroTier control-plane credentials to browser code. The client
proof-of-control contract remains to be specified. **Player binding design:
0%; implementation: 0%.**

## Multiple sign-in methods for one visitor

The user's ElseMesh account key is the canonical account identity. A user may
link several independently verified external identities to that account,
including multiple Google accounts plus Facebook and Telegram accounts.
Linking a new method requires proof of control of that provider identity and
authorization from the existing account key; matching email addresses,
display names, IP addresses, or ZeroTier addresses never merge accounts. Each
provider identity is keyed by its issuer and stable provider subject. The target account broker must support
linking, unlinking, revocation, recovery, and key rotation without treating any
provider as the owner of the ElseMesh account. A display name such as `loz` is a
world-local label, not an identity.

The broker must not send Facebook, Google, or Telegram bearer tokens, raw
provider subject IDs, or account session secrets to `worldd` or neighboring
worlds. After interactive sign-in, it issues a short-lived signed assertion
that proves possession of the ElseMesh account key and, with the visitor's
consent, identifies the verified authentication method or methods and their
authentication time/assurance. A
world can check which method was used or which linked methods were verified
without receiving a reusable provider token. The world may request a stronger
or more recent proof when its access policy requires one.

**Implementation gap:** the current broker maps Google sign-in to one account
key for authoring actions. It does not yet support multiple linked provider
identities per account, Telegram sign-in, account assertions for world entry,
or stable world-local visitor identifiers.

## Invite provider choices and public identity

An invitation may authorize one or more sign-in providers: Facebook, Google,
and Telegram are the initial target set. The invitation creator selects the
allowed methods, and the visitor may authenticate through any enabled method.
The visitor can link it to an existing ElseMesh account after proving control
of that account, or create an account if needed. For a friend who uses all
three, the owner can enable all three choices on one invitation.
For a person-specific invite, every enabled provider option must be tied to an
identity that the invite authorizes for that same player; a login from an
unrelated account at an allowed provider is not enough. Provider verification
must establish the association before admission.

After authentication, the visitor must be asked which one of their verified
Facebook, Google, or Telegram identities they want other players to see. This
is a public-identity choice, separate from which provider authenticated the
session: a visitor may authenticate with Google and display a linked Facebook
or Telegram profile, if that identity was independently verified and linked
to the same account key. Show only the selected provider identity and its
chosen display label/link. Offer a
private/no-link choice, and let the visitor change or withdraw the selection.
A world may retain its own per-world choice; trusted portal handoff carries the
selection only with the visitor's consent and the destination's acceptance.
Authentication methods and linked identities stay private unless separately
disclosed by the visitor; a public profile choice does not disclose every
linked account.

Authentication subjects and tokens are never public profile links. Construct a
hyperlink only from a provider-returned or user-supplied profile URL that has
been checked against that provider's allowed HTTPS host and explicitly
confirmed by the visitor; never derive it from an email address or opaque
provider subject. The visitor's account key signs the disclosure for the
intended world, proving consent to publish it; it does not by itself prove the
URL belongs to the provider account. A host check confirms the destination
domain, not account ownership: mark user-entered links unverified unless provider proof binds them
to that account. Provider capabilities differ: Google People API can return
`urls[]`, but does not guarantee a public profile URL for every account;
Facebook profile links use the permission-gated `user_link` field and may not
resolve for every viewer; the Telegram login widget may return a username,
which can form a `t.me` link and may change. Missing or inaccessible profile
links must be shown as unavailable rather than invented. See the [Google People API](https://developers.google.com/people/api/rest/v1/people),
[Meta profile-link permission notes](https://developers.facebook.com/docs/facebook-login/changelog/),
and [Telegram login widget fields](https://core.telegram.org/widgets/login/).

**Implementation gap:** invite-level provider allowlists, the required
post-authentication identity prompt, validated provider profile links,
visibility consent, per-world identity records, and matching invited provider
identities to the authenticated account are not implemented.

## Reusing authentication through a trusted neighboring world

At portal crossing, the browser may present an account-broker assertion for
the destination world and a one-time introduction signed by the source world's
owner key. The introduction binds the verified account assertion to the
current source session, source world, destination world, portal, expiry, and
replay nonce. The source world cannot invent or strengthen the broker's
authentication claims. The destination verifies both signatures and accepts
the introduction only if its own signed access policy trusts that source
world and accepts the asserted authentication method and age.

When accepted, the destination creates or updates its own known-player record,
keyed by a destination-specific pseudonymous account subject. It may record the
verified method evidence, introduction source, first/last visit, and the local
display name chosen by that visitor, plus the selected public profile link if
the visitor consented to share it. The public player view exposes only the
single profile link the visitor selected; the set of linked accounts and
authentication methods remains private unless separately disclosed. The
browser need not prompt for another login while the proof is valid and the
destination's trust policy accepts it.
Each destination retains final control over access, bans, visitor limits,
avatar rules, and saved state; a neighbor's introduction grants no roles or
privileges. If the source is not trusted, the assertion has expired, the
destination requires stronger authentication, or account proof is unavailable,
the destination applies its ordinary guest/invitation policy and may ask the
visitor to authenticate directly.

Use a destination-specific subject by default so two unrelated worlds cannot
correlate a visitor merely by comparing IDs. The account broker can reproduce
the same subject for that destination on later visits, including visits reached
through a different linked sign-in method. Store the minimum evidence needed
for local recognition and authorization; discard consumed bearer assertions
and retain replay/revocation state only as long as required by policy.

**Implementation gap:** trusted-neighbor identity introductions, signed
cross-world account assertions, destination known-player records, and
no-reprompt portal handoff are design requirements only. Current portal
presence carries no verified account identity between worlds.

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
