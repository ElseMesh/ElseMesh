# ElseMesh network qualification — 15 October 2026

**Release disposition: FAIL / HOLD. This document is a qualification record, not a production-readiness declaration.**

Scope: `lozknowles/ElseMesh` at `main` baseline `9571984`, isolated branch `feature/network-federation-hardening`. Keep the separate procedural builder PR #4 draft and preserve the live site.

## Corrections introduced on this branch

1. Browser WebSocket room client retries transient connection loss with jittered bounded exponential backoff and manual-shutdown suppression. Explicit policy rejection (1008), invalid binary (1003), or oversized frames (1009) does **not** silently downgrade or retry.
2. The client retains the latest player pose and resends it on a fast successful rejoin (under 3 seconds), never resurrecting long-stale local state. Outbound movement is replaceable: when the client WebSocket buffer exceeds 64 KiB, it skips that sample rather than growing an unbounded movement backlog. Economy and helicopter actions reject a too-congested socket.
3. The room server caches each currently connected participant's last accepted state, supplies fresh snapshots to late joiners/rejoins, and removes snapshots on disconnect. States older than 8 seconds are not reintroduced. In-memory snapshots are not persistent world saves.
4. `acceptPortalHandoff` enforces source signature, authority and portal checks **plus** portal allowlist and an explicit fail-closed destination-side admission callback. The admission decision must match the exact player, session and destination region; missing/mismatched decisions are denied. An authenticated source handoff does not grant destination admission by itself.
5. The experimental unencrypted native TCP/UDP listener defaults to loopback and refuses a non-loopback bind without a clearly named unsafe development opt-in. The physical probe likewise requires `--allow-insecure-development` for LAN exposure. Do not use this reference transport on the public Internet.
6. Added reconnect, stale-state, congestion, denial, reference-transport binding, and snapshot regression tests, included them in `test:network`, and added a dedicated Ubuntu/Windows PR workflow.

This is limited hardening of the existing implementation, **not** a finished federation or global multiplayer release.

## Checks run on MSI Windows / Node 24.19

- Baseline `npm run test:network`: 32/32 passed.
- Baseline `npm run test:security`: 6/6 passed.
- Modified `node --test test/federation.mjs test/online-reconnect.mjs`: 13/13 passed.
- Existing network suite, general regression suite, security suite and Vite production build ran successfully after the initial code changes. Final branch-head CI must independently repeat all checks.

## Strict release gates

| Gate | Current disposition | Required independent evidence |
| --- | --- | --- |
| G1 Cross-world admission and owner authority | FAIL | Two independent real WSS world services, authenticated owners, persistent challenge/grants and denial across multiple ingress routes |
| G2 Durable identity, revocation and replay | FAIL | Signed browser node challenge, owner key rotation, persistent replay prevention across service restarts |
| G3 Federation, n player-owned nodes | FAIL | Real browser portal join, return and guest rules with independently deployed nodes; no single-world room substitution |
| G4 Congestion and interest management | PARTIAL | Dynamic subscriptions, scene/view relevance, bandwidth adaptation, reliable-event isolation, WSS vs WebRTC latency comparison |
| G5 Disconnect/reconnect/resume | PARTIAL | Real browser Wi-Fi and network migration, browser suspend/resume, reconnect after server restart, durable inventory resync and verified duplicate suppression |
| G6 Security and denial tests | PARTIAL | Independent penetration testing, fuzzing, rate abuse, NAT/relay and TLS end-to-end validation |
| G7 Real-world latency, 2/4/10/25/50 peers | BLOCKED | p50/p95/p99 transport, queue, bandwidth, traffic and availability across WAN RTT/jitter/loss/packet reorder; multi-host evidence |
| G8 Render/FPS impact | BLOCKED | Matched before/after physical WebGPU hardware, raw frame times, corrected 1% low formula, GPU timing and remote-world window stress |
| G9 Argon independent second opinion | BLOCKED | Verified Gemini 4 Argon execution in the user's authorised Google AI Pro session, sanitized source and comparison record |
| G10 Rollback/release rehearsal | BLOCKED | Exact prior production SHA, tested rollback, cross-browser state portability and proof all gates pass on release SHA |

**All ten gates must PASS before merge, tag or GitHub Release.** A local green unit test is evidence of one bounded condition, never an unconditional guarantee of Internet availability/security.

## Known limitations and release hazards

- The current online-room server still has ten named roles and a single fixed `WORLD_ID`/`SECTOR_ID`; this is not an n-world fabric.
- Browser room `nodeId` is asserted in player state but lacks a join-time private-key possession challenge; signed federation cannot treat room membership as authenticated ownership.
- The native reference TCP/UDP adapter remains unencrypted and must never be exposed publicly.
- The state path uses reliable WebSocket delivery; position snapshots can still experience head-of-line blocking already in flight. Client queue shedding reduces added load but is not a substitute for partial reliability/interest management.
- Browser reconnection does not restore a restarted server's nonpersistent inventories, sessions or authority epochs. Two separate browsers do not share a persistent world identity.
- The required procedural builder FPS 1% low metric in PR #4's fps probe was previously computed from a single percentile frame rather than the mean of the slowest one percent; the separate PR needs correction and rerun.
- CI, unit tests and local synthetic clients cannot prove WAN quality or peer-to-peer NAT traversal.
- No live deployment or GitHub Release is permitted while any critical gate is not PASS.

## Next work in recommended order

Authenticate two independent WSS world services; implement explicit destination grants and a real browser portal transfer, including failure rollback. Add owner-root and operational-key separation with revocation and durable replay tracking. Implement interest-managed entity/window replication with properly profiled WSS then evaluate WebRTC unordered/partial reliability. Add persistent session snapshots and restart recovery. Perform multi-machine WAN impairment benchmarks and matched physical GPU FPS measurement; obtain and adjudicate the independent Argon review. Rehearse rollback, then release only from the exact fully qualified SHA.
