# Changelog

## Experimental preview — 16 October 2026

- Published a separate static preview path for collaborators, built from a
  pinned commit on draft PR #5. The preview shows a visible experimental label
  and scopes browser saves and demo identity away from the existing public site.
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

**Status:** Experimental preview for development. Draft PR #5 remains open.
Cross-world avatar entry/return, inventory transfer, public WSS ingress,
packet-loss and browser FPS qualification, recovery and abuse testing, and the
second independent Argon verdict are outstanding. No production multiplayer
release or GitHub tag is claimed. See
[`docs/FEDERATION-PHASE2-QUALIFICATION.md`](docs/FEDERATION-PHASE2-QUALIFICATION.md)
and [`docs/ARGON-REVIEW-ADJUDICATION.md`](docs/ARGON-REVIEW-ADJUDICATION.md).

## Current public build

The existing [ElseMesh Pages build](https://lozknowles.github.io/ElseMesh/)
continues to serve the previously published island game. This preview does not
replace that build or merge draft PR #4 or #5.
