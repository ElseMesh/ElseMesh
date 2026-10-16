# ElseMesh federation — in-place renewal and local 3D view prototype

**2026-10-16 — Draft PR #5 only; NOT RELEASE READY.**

This increment extends the signed, owner-authoritative WSS proof from `17bb5f3`.
It does not deploy a remote world, migrate a running player, or render remote
landscape geometry in production.

## Authenticated in-place destination grant renewal

The previously fixed 10-minute disconnect is addressed through an opt-in
application-level renewal exchange:

1. The authenticated client sends a `renew-request` before its destination
   admission grant expires. The default renewal lead is 60 seconds; shorter
   test leases renew proportionally earlier.
2. The owner authority signs a new, five-second challenge with fresh random
   nonce, current world/region/epoch, player key fingerprint and *existing*
   destination session ID.
3. The browser signs a separate `elsemesh-world-renew-proof/1` with its
   non-exportable Ed25519 key. The server verifies the signer, issued time,
   nonce, session, world and current epoch.
4. The destination **rechecks admission**; revoked users fail closed. On
   success it issues a new owner-signed grant with the **same** session ID and
   unchanged epoch, optionally reduced permissions.
5. The client verifies the refreshed grant and schedules the next renewal,
   without resubscribing, replaying travel or recreating the renderer.

A missed renewal is treated as a disconnected session, not success.
The world service's expiry/heartbeat checks remain in place.

Focused tests verify session continuity and reauthorization denial. These
tests use a six-second lease; production default is ten minutes. A short
1.5-second test lease was observed to flake with concurrent test workload;
renewal was moved earlier and the test increased to six seconds. Actual
browser-sleep and multiple-physical-host trials remain required.

## Existing WebGPU scene integration (debug-only)

`FederationScenePreview` projects a validated remote snapshot (no more than
64 public entities, kind/player/npc/prop, positions/yaw) into ElseMesh's
**existing scene and rendering pipeline**, using very low-poly proxy meshes.
It reuses geometries/materials, updates transforms in place, removes entities
missing from the latest snapshot, rejects malformed replacements atomically,
and immediately hides/removes all meshes on disconnect. It does not run or
download remote scripts, media, GLBs or shaders.

`FederationPreviewController` wires the verified `FederationView` events
to that scene. This is specifically **not** a separate renderer or completed
remote 3D world: no remote terrain, lighting, buildings, player movement
authority, ownership handover, portal framebuffer, inventory or persistence
is supplied here.

It can only be enabled on a LOCAL browser origin
(`localhost`, `127.0.0.1`), when `?federationPreview` is supplied,
and requires a manually pinned exact owner/world/region/endpoint/player
identity in the URL fragment. Normal live ElseMesh does not enable it:

```
http://127.0.0.1:5189/?federationPreview#endpoint=ws%3A%2F%2F127.0.0.1%3A5200%2Fworld&owner=elsemesh-node%3A<full-pinned-fingerprint>&world=<url-encoded-worldId>&region=<url-encoded-regionId>&player=player%3Avisitor&center=0%2C0%2C0&radius=100
```

This is a template, not a working public server or a command to launch it.
The local world server must be running, enforce an exact browser Origin and
allowlist the visitor's real browser signing key. No universal guest admission
should be configured on a production owner. Do not put secrets in the URL.
CORS/HTTPS/proxy/other-host trust gates still apply to any real deployment.

## Qualification evidence

- Local `node --test test/federated-world-wss.mjs test/federated-recovery.mjs
  test/federation-scene-preview.mjs`: signed renew/deny and proxy lifecycle.
- `npm run test:network` runs those tests with existing room/federation
  regressions. All 52 tests passed locally on MSI.
- Vite production build passed; the preview is split into a dynamic chunk.
- No actual physical GPU screenshot, frame-time/FPS, window/portal shader,
  remote landscape benchmark or WAN-loss test was performed for this
  increment. The earlier signed-snapshot 50-world localhost performance
  regression remains unresolved.

## Release gate

**HOLD** — not merged, tagged or deployed. Missing: complete remote WebGPU
scene/asset and avatar authority transfer; atomic inventory/region handoff;
public encrypted WSS and ownership/revocation; external multi-host WAN
latency/loss tests; WebRTC comparative transport profile if useful; real
browser FPS and 1% lows with GPU telemetry; adversarial fuzzing, rollback
and repeat Argon final SHA signoff. The prior Argon remediation follow-up
has not produced a verifiable completed response and is not treated as approval.
