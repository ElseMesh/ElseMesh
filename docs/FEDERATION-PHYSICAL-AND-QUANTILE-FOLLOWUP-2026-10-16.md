# Federation physical probe and benchmark correction — draft PR #5

**Release status: HOLD.** This note follows `e19e911`. No production deployment or PR #4 change is part of this work.

## Independent review finding addressed

The user supplied the full original Argon review of `b1c7361` (13 inspected files, static analysis only). It identified that the loopback benchmark's `Math.floor((N - 1) * p)` helper reports the second-slowest of ten samples as p99. The benchmark now uses the nearest-rank definition, `ceil(N × p) - 1`; a focused regression test asserts that p99 of ten observations is the maximum. This fixes the sample statistic, not the small sample size or the lack of a controlled comparison. The earlier recorded p99 values are retained as historical output from the old helper and should not be interpreted as corrected p99 values.

`docs/evidence/federation-loopback-corrected-2026-10-16.json` is a fresh one-machine loopback run with the corrected helper. For 2/4/10/25/50 local WS owner services and five requests per service, it recorded zero failures. The 50-service p99 was 29.89 ms in this run. Timing differs from the earlier run and cannot be attributed solely to the statistic correction. This does not profile isolated signing CPU cost, WAN, browser FPS, or encrypted public ingress.

## Two-machine protocol proof

Two physical machines ran the same `563a21a` source revision for the protocol probe, each with a fresh test identity. The destination reference service remained loopback-bound. A temporary authenticated SSH command-channel relay carried the source's TCP stream; normal SSH port forwarding was administratively blocked. The existing `federation-probe.mjs` completed signed descriptor verification, destination portal admission and signed return handoff, reporting `federation-roundtrip: PASS` with the explicit scope `protocol-only-no-rendered-avatar`.

On one persistent connection, 100 signed region request/response samples measured 3.12 ms median and 3.99 ms p95. In a separate run, the relay added 50 ms one-way delay with ±10 ms jitter to each direction; 50 samples measured 121.93 ms median and 125.82 ms p95. These are application-level relay delays over a private SSH route. They did not emulate packet loss or prove natural WAN, browser gameplay, public WSS, NAT/relay selection, or state transfer. Test services were stopped and temporary private signing keys removed after the run.

## Argon and release boundary

The pasted review is the first verdict, not the requested follow-up on the 66,750-byte `17bb5f3` diff. The original is preserved privately in this task's outputs; `docs/ARGON-REVIEW-ADJUDICATION.md` records all 13 original findings and their initial disposition. A second verdict must be preserved and adjudicated separately when accessible. Live cross-world WebGPU terrain, avatar/inventory entry and return, actual remote-view browser FPS, packet-loss/reconnect trials, sustained scaling, denial-of-service tests, crash recovery and rollback remain open. Keep PR #5 draft and production unchanged.
