# ElseMesh — Argon independent network audit, adjudication & release gate

Date: 2026-10-16. Branch: `feature/network-federation-hardening` (draft PR #5). Baseline reviewed: `b1c73619c2b6a297d13c917f47de00923dbaf35b`. **RELEASE HOLD — FAIL FOR PRODUCTION.**

## Independent review provenance

The signed-in `collingham` Chrome Gemini UI identified its current model via the accessible control: **“Open mode picker, currently Argon”**. The first request failed because Argon's web-browsing tool could not retrieve GitHub source; it correctly stopped after inspecting zero files. A second request included a locally prepared text attachment (`ARGON-EXACT-SOURCE-BUNDLE.txt`) containing **13/13 priority source and test files**, extracted with `git show COMMIT:PATH`, with original line numbers. Bundle SHA-256: `FF494A13EFE19EAE2F49078068B89B924023A2E2A842CD6DBE76774DABBF2074`. Argon confirmed the attachment was accessible and read in full. The response was saved via the Windows UI accessibility tree at `docs/ARGON-SECOND-OPINION-2026-10-16.txt` in the separate MSI qualification working copy (this verbose raw transcription is not bundled into the PR).

Argon judged the phase-two prototype **PARTIAL** and a production release **FAIL**. The model review is independent analysis, not dynamic penetration-test proof.

## Findings and audited disposition after the remediation slice

| Original issue | Finding | Remediation in this branch | Qualification |
| --- | --- | --- | --- |
| CRITICAL-01 | Signed portal handoff lacked playerNodeId and destination audience/session binding | New incompatible `elsemesh.handoff/2` includes and validates playerNodeId, destinationAuthority, destinationSessionId; destination checks all against authenticated socket grant. Mismatch unit tests. | Code mitigation PASS; external independent owner deployment not tested |
| CRITICAL-02 | Append-only replay ledger eventually exhausted and restart could fail on interrupted last write | TTL replay entries, pruning, atomic compaction, discard unacknowledged trailing fragment, reject corrupt committed records; restart/TTL tests. | PARTIAL: synchronous `fsyncSync`, crash consistency under actual power loss and overload remain unqualified |
| HIGH-01 | 64 unauthenticated connections could exhaust world client slots | Distinct pending-auth cap of eight, 5-second challenge deadline, slot-return regression. | PARTIAL: eight malicious pending sockets can still starve newcomers; requires ingress-level abuse mitigation and rate controls |
| HIGH-02 | Unsigned snapshots not audience-bound | Each snapshot signed by the world owner and bound to world, region, authority epoch and viewer session; browser verifies Ed25519 and rejects tampering, wrong audience and stale revision. | Code mitigation PASS; added signing/bandwidth overhead requires optimising |
| HIGH-03 | Silent entity truncation; no actual player-avatar state transfer on travel | No complete fix in this slice. | FAIL |
| HIGH-04 | Post-auth client errors were swallowed; pending portal futures leaked; stale packets could kill a view | Emit protocol errors; clear pending handoff IDs; reject visit on protocol error; discard stale/old revision packets rather than treating as identity failure. | PARTIAL; needs hostile-frame and sleep/reconnect browser tests |
| MEDIUM-01 | Canonical-JSON edge cases and WebCrypto compatibility | No general RFC 8785 implementation yet. Existing constrained signed objects test against Node/WebCrypto. | PARTIAL |
| MEDIUM-02 | Superseded sockets reconnect and steal each other's slot | Dedicated 4009 supersession close and deny retry; reject revoked sockets immediately; regression. | PARTIAL; test actual multi-tab/device client |
| MEDIUM-03 | Ten-minute session admission expires without in-place renewal | Not yet resolved. | FAIL |
| MEDIUM-04 | Room role/host claims in legacy online-server | Legacy room mode isolated from new federation. Follow-up audit needed. | OPEN |
| MEDIUM-05 | Reverse proxy/origin trust and arbitrary remote URL access | Backend loopback restricted; browser only permits `wss:` except localhost. Proxy/DNS/redirect policy unqualified. | OPEN |
| LOW-01 | Repeated distance computations and per-peer snapshot signing | Not optimized; benchmark overhead measured below. | OPEN |
| LOW-02 | In-memory replay/speech ID eviction policy | Separate from durable world handoff ledger, but still needs abuse stress testing. | OPEN |

## Performance evidence (single MSI, loopback only, NOT WAN)

The committed tests create 2/4/10/25/50 distinct world services with owner keys but all on **one MSI Windows machine**. Five snapshot requests per node are measured. These are short, unmatched individual runs with different timing conditions, not a calibrated A/B experiment.

| Worlds | Before p99 ms | Signed-snapshot branch p99 ms | Before bytes | Signed branch bytes |
| ---: | ---: | ---: | ---: | ---: |
| 2 | 1.12 | 2.50 | 18,678 | 22,618 |
| 4 | 0.80 | 2.61 | 37,356 | 45,236 |
| 10 | 2.03 | 7.03 | 93,390 | 113,090 |
| 25 | 4.84 | 12.60 | 233,715 | 282,965 |
| 50 | 8.81 | 24.22 | 467,590 | 566,090 |

Signing snapshots plausibly increases CPU and packet size, but the table alone does not prove causality. Compare frozen signed/unsigned branches under alternating, controlled conditions and require WAN RTT/jitter/loss before setting game targets. Current p99 includes whole local request/response and owner signature + browser verification costs. FPS was **not measured** here.

Raw benchmark files: `docs/evidence/federation-loopback-2026-10-15.json` and `docs/evidence/federation-argon-hardening-loopback-2026-10-16.json`.

## Release blockers remain

- Real owner-to-owner 3D WebGPU portal entry/return, renderer update, remote player avatar state and inventory transfer/rollback, in-game remote scene preview and scene streaming.
- Actual encrypted WSS Internet ingress, per-owner ACL and revocation, owner-key succession, destination-grant reissue, reliable crash/power-failure recovery and denial-of-service load/ingress testing.
- Several physical hosts and browsers across WAN, impaired RTT/jitter/loss, session migration/renewal, NAT/relay, malicious client fuzzing and security review of all trust boundaries.
- Matched hardware-rendered FPS, 1%-low correction in separate procedural PR #4, GPU timing and frame-time distributions for real remote views. Production rollback rehearsal.
- Performance optimization of snapshot signing and replay disk sync overhead, with regression budgets.
- Re-review of fixed SHA by Argon or a human reviewer before treating findings as closed.

**Do not merge, deploy, tag, or create a GitHub Release from this branch while any blocker remains.** The user's strict qualification requirement means green unit tests are necessary but insufficient.
