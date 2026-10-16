# Snapshot completeness follow-up — draft PR #5

This change follows `90f7367` and remains experimental. The signed owner snapshot now includes `visibleCount` (all public entities inside the requested interest radius) and `truncated` (whether fewer entities were sent). The browser verifies those fields as part of the owner signature and rejects an inconsistent count or flag. The local opt-in WebGPU proxy panel displays sent/visible counts and identifies a limited view. This closes silent clipping of the snapshot *representation*; it does not implement pagination, adaptive level of detail, or complete scene delivery. Gameplay must not use the limited view to infer that omitted entities are absent.

The experimental wire protocol is now `elsemesh.world-wss/2`. The new browser and owner service must be updated together. A v2 browser rejects a v1 challenge; a v1 browser's join is rejected by a v2 owner. This deliberate incompatibility prevents a mixed-version client from accepting a signed v1 snapshot without completeness metadata. Version negotiation is still required before independently deployed owners support rolling upgrades.

The grant-renewal and local 3D proxy changes arrived concurrently in `90f7367`. This follow-up preserves that challenge-bound renewal implementation and fixes its Controls CI publication scan: the preview test now constructs its private-LAN negative case without embedding a private address literal in publishable source.

## Local evidence

- `npm run test:network`: 53/53 pass, including two-owner signed local WS travel, replay, renewal, policy revocation, both entity-cap and byte-budget clipping, and inconsistent signed snapshot rejection.
- `npm test`: 71 pass, one real-GPU test skipped by its existing gate; no default-island regression was found by this suite.
- `npm run test:publication`: 8/8 tests and the generic publication scan pass. The operator-specific literal scan was unavailable because no external configuration was supplied.
- `npm run build`: passed after this follow-up.
- `docs/evidence/federation-loopback-current-2026-10-16.json`: one single-machine loopback run. It started 2/4/10/25/50 independent **WS** world services in sequential scenarios, with five concurrent-per-round snapshot requests per world and zero recorded failures. At 50 services the observed p99 was 24.74 ms and total outbound bytes 575,090. This is not a controlled before/after test and cannot isolate signature cost. No browser FPS, WAN impairment, multiple physical machines, TLS/WSS ingress, or power-loss recovery was measured.

The Google Argon follow-up response was not accessible in this session: the computer-use inventory exposed Edge but no signed-in collingham Chrome/Gemini tab. The original finding table remains in `docs/ARGON-REVIEW-ADJUDICATION.md`; no second verdict is claimed.

## Architect gates and decision

- Plan gate: before implementation, architect recommended destination-owned admission, challenge-bound session renewal, signed audience-bound snapshots, a verified-state rendering consumer, and explicit portal failure recovery. The primary followed that sequence and kept portal movement open because the source-owner command and atomic state transfer do not yet exist.
- Completion gate: architect identified the unchanged protocol version, missing byte-budget and malicious-metadata tests, and imprecise evidence wording. The primary bumped the experimental wire to `/2`, added both tests, corrected the benchmark description, and retained the release hold. The gate is conditional for this bounded follow-up, not approval of production multiplayer.

## Release decision

**HOLD — NOT RELEASE READY.** Snapshot completeness is disclosed, but actual remote terrain/asset rendering, source-owner initiated portal movement, avatar state/inventory commit and return, WAN ingress and multi-device browser/FPS qualification, abuse and crash testing, Argon re-review, and rollback rehearsal remain open. Do not merge, deploy, or tag from this evidence.
