# Changelog

## Draft cross-world work — 16 October 2026

- Prepared a separate static preview publisher from a pinned draft PR #5 commit.
  Its deployment was canceled and its workflow disabled after the requirement
  was clarified: a friend-ready build must include live cross-world travel.
- Added an opt-in federation source prototype: signed world identities,
  destination admission and replay protection, signed bounded snapshots,
  session renewal, and a local 3D remote-scene proxy. These components have
  focused tests; the public preview does not connect to an internet world.
- Corrected the loopback latency benchmark's percentile calculation. The
  previous p99 figures were based on a different helper and are retained only
  as historical evidence.
- Verified a signed protocol round trip between two physical machines over a
  private SSH relay. This was a protocol test, not rendered browser gameplay
  or natural WAN qualification.

**Status:** No friend-ready cross-world preview is live. Draft PR #5 remains open.
Cross-world avatar entry/return, inventory transfer, public WSS ingress,
packet-loss and browser FPS qualification, recovery and abuse testing, and the
second independent Argon verdict are outstanding. No production multiplayer
release or GitHub tag is claimed. See
[`docs/FEDERATION-PHASE2-QUALIFICATION.md`](docs/FEDERATION-PHASE2-QUALIFICATION.md)
and [`docs/ARGON-REVIEW-ADJUDICATION.md`](docs/ARGON-REVIEW-ADJUDICATION.md).

## Current public build

The existing [ElseMesh Pages build](https://lozknowles.github.io/ElseMesh/)
continues to serve the previously published island game. The canceled preview
does not replace that build or merge draft PR #4 or #5.
