# ElseMesh federated WSS phase-two qualification — 15 October 2026

**RELEASE HOLD — PARTIAL, NOT PRODUCTION MULTIPLAYER.**
Applies to draft PR #5 branch `feature/network-federation-hardening`. Main, GitHub Pages and draft procedural-world PR #4 are not modified or deployed.

## Actual delivered code

- New `tools/networking/federated-world-server.mjs`: stand-alone, single-owner, loopback-bound WSS service, separate signed world/region manifest, explicit exact browser origin and destination-player admission policy, 5-second owner-signed cryptographic nonce challenge, bounded frames/rate/connection count, 15-second heartbeat and active-session expiry/renewal.
- `src/network/FederatedWorldClient.js`: portable browser WebCrypto Ed25519 proof, pinned world owner signing key fingerprint, canonical signed manifest integrity verification, client/signer-bound admission grant and portal arrival verification. Plain WS only allowed for loopback development.
- `network/DurableHandoffReplay.mjs`: sync-to-disk portal handoff replay ledger; records rejected across server restarts, corrupt/full ledgers fail closed. This is not a general-purpose distributed replicated log.
- `src/network/FederationView.js`: isolated remote-world subscription, bounded exponential reconnect, removal of stale disconnected view, automatic fresh snapshot subscription on reconnect, explicit travel acknowledgements (travel is never automatically replayed).
- Subscription interest filters at most 64 entities within a 250 m radius; only schema-limited public state fields are transmitted and output is bounded. No executable assets, world-script execution, or remote file paths.
- Both world owners retain their distinct Ed25519 authority keys. A new authenticated session for a given player key supersedes the old session, preventing accidental duplicate online avatar authority.

## Evidence — MSI, local process/socket tests

- `node --test test/federated-world-wss.mjs test/federated-recovery.mjs`: independent owner-signed WSS worlds, challenge verification, unauthorised visitor denial, signed inbound and return travel handoffs, replay both before/after restart, interest filter, single-authority-session takeover, owner-key mismatch rejection, recovery/re-subscription after destination restart and policy fail-closed.
- `npm run test:network` includes the new suites along with legacy multi-player room/security regression tests.
- `node tools/networking/benchmark-federation.mjs docs/evidence/federation-loopback-2026-10-15.json` produces observed 2/4/10/25/50 independent WSS world services with unique signing keys on **one physical MSI device**. Five request-response snapshots per world. The JSON stores each scenario's observed p50/p95/p99, total bytes, heap, RSS, and failures. These are loopback figures, not internet latency, external availability or network loss recovery proof.
- `npm run build` ensures the source still bundles with existing Vite WebGPU game.
- No evidence here claims the engine actually renders other owners' live 3D scenes, controls a remote world avatar, or dynamically chooses a real portal destination inside the existing App.

## Strict release gates

| Gate | Current | Required to qualify |
|---|---|---|
| G1 Signed independent world identity / owner policy | PARTIAL | Real independent external WSS deployments, TLS and proxy hostname verification, separated owner and service keys, owner revocation |
| G2 Browser player identity / cryptographic challenge | PARTIAL | Confirm browser support on all target browsers, long-lived key rotation/recovery, account/device linking, end-to-end browser challenge in published app |
| G3 Portal round-trip and destination session | PARTIAL | Normal avatar movement through live WebGPU cross-world portal with independent authority and render/failback, inventory consistency |
| G4 Replay and crash recovery | PARTIAL | Durable one-time source/destination admission protocol, crash-safe world/item checkpoint and region authority migration; denial/timing race stress |
| G5 Remote view relevance, bandwidth | PARTIAL | Actual rendered world windows and adaptive visible-scene subscriptions; geographically bound permissions and real congested connection trials |
| G6 Reconnect, suspend, handover | PARTIAL | WAN outage/packet loss, browser sleep, roaming phones, old-session fencing and functional player/inventory resynchronisation |
| G7 N-world scaling | PARTIAL, local only | Multiple physical hosts/real WAN; independent performance baselines across all relevant hardware, RTT/jitter/loss, 50-node sustained run |
| G8 Security hardening | PARTIAL | Security audit, network fuzzing, DoS/proxy tests, encrypted Internet ingress, cross-owner revocation and threat-model closure |
| G9 Graphics | BLOCKED | Same-hardware frame-time data, p95/p99, correct 1% low calculation, visibility culling/LOD, GPU workloads with real rendered remote windows |
| G10 Independent Argon review | BLOCKED | Google AI Pro Argon second pass through an authorised signed-in session; no claim of invocation without evidence |
| G11 Rollback + release candidate qualification | BLOCKED | Full integration CI, true production-build browser rehearsal, original release SHA and rollback rehearsal, all gates PASS |

**Do not merge, tag, publish a release or alter production until each gate independently PASSes on an exact SHA.** A finite test suite cannot promise that the internet will never drop connections; a rigorous qualified release requires measurable SLOs, failure injection and safe recovery, with documented limits.

## Security assumptions and trade-offs

A destination owner chooses `authorize` and must bind the requested PlayerID to its verified Ed25519 NodeID. The browser **pins the expected owner NodeID**; DNS, hostnames and overlay membership alone cannot create owner authority. The new service requires loopback binding and explicit reverse-proxy TLS configuration for real WAN use. It is not a replacement for a deployed secure ingress.

This phase uses WSS ordered reliable delivery, sends full bounded snapshots, and suppresses stale state on disconnect. It does not implement WebRTC/QUIC datagrams or congestion-control transport parity. A WSS-only client can experience transport head-of-line blocking, so low local RTT does not establish good experience on the internet. The game-room code and new federation service remain distinct. There is no migration of inventory/economy or arbitrary user uploaded assets across owners.

Current replay ledger is bounded and fail-closed at capacity; it is not replicated across multiple failover authorities. World entity state itself remains owner-managed in memory. Explicitly persist/apply world edits and inventory before production.

## Next implementation slice

Integrate the signed travel client and subscription with the real WebGPU portals and streamed world assets, then run multi-device WAN failure/graphics tests and independent Argon review. Keep existing single-island and room mode as default. Ship only with all release gates closed.
