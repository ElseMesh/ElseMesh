# Shared player presence

Each visitor's browser runs local gameplay and physics wherever practical. Presence is the transient, self-reported avatar state that the world server validates, stores, and relays so other visitors can render that player; it does not move ordinary gameplay simulation onto the server. Guest presence does not require a Google account. The production `WorldConnector` exposes update/leave requests and validates outgoing poses. `PlayerPresence` validates snapshots, binds world/session/request IDs, removes departed peers and interpolates remote poses with shortest-path heading rotation. The active-world frame publisher and animated remote avatar renderer are integrated. Only entered worlds publish presence; handoff disposes the previous session and its avatar resources.

## Connection and ownership

Both the existing WebSocket gateway and WebTransport gateway accept `presence.update` and `presence.leave` after their ordinary world handshake. They bind every request to the selected world and target node, overwrite any browser-supplied session identifier with a fresh random 128-bit identifier, and derive the player ID from that session plus the gateway's identity. The client cannot select another player's ID.

A gateway can forward these requests to the world owner over the existing authenticated libp2p stream. The owner namespaces the forwarded session by the actual remote peer ID, not a claimed JSON identity. Clients arriving through different gateways share the owner's presence set. A cache or failover manifest provider rejects live presence authority with `presence_owner_required`; replica permission does not grant simulation or presence authority. The browser integration must use an owner connection for presence when content comes from a cache. Delegated live authority and continuity across owner failure remain outstanding.

A successful update returns `type: "presence"`, matching `worldId`/`requestId`, `playerId` for that connection and a sorted `players` snapshot. Each entry has `id`, the pose fields below, and an owner-generated Unix-millisecond `updatedAt`. The server holds at most 128 players per world, accepts at most 20 updates per second per active player, rejects repeated/decreasing sequences, and removes entries after ten seconds without an accepted update. Closing a connection sends a leave through the same route; TTL handles interrupted or unreachable teardown. A new transport session gets a new player identity. Account identity is not implied by that ephemeral ID.

## Pose and appearance contract

An update request contains `type: "presence.update"` and `pose`:

```json
{
  "protocol": "elsemesh.player-presence/3",
  "sequence": 1,
  "position": [1, 2, 3],
  "yaw": 0.3,
  "pitch": -0.2,
  "moving": false,
  "mode": "walk",
  "avatarProfileId": "elsemesh.avatar.stock-male/1",
  "appearance": {
    "style": "male",
    "shirt": "#7194aa",
    "trousers": "#27313d",
    "skin": "#c68c67",
    "hair": "#33251c"
  }
}
```

Position is the avatar's feet in signed world coordinates: right-handed, Y-up, meters. Exactly three finite coordinates are required, each within ±100,000 m. Sequence is a JavaScript-safe nonnegative integer and increases within an active session. Yaw is finite and bounded to ±1,000 radians; the client should normalize its accumulated heading. Pitch is finite within ±1.5 radians. Supported modes are `walk`, `swim`, `deck` and `boat`. Every pose includes `avatarProfileId`, which must match the profile selected by the validated appearance style. A `deck` or `boat` pose also includes a stable `vehicleType` and finite, nonnegative `vehicleSpeed` in metres per second. The owner applies signed avatar allowlists to every admission. Vehicle presence additionally requires destination vehicle acceptance, a compatible berth, an allowed avatar/vehicle pair when configured, avatar-plus-vehicle complexity within budget, and reported speed within the signed cap. Portal handoff applies those same profile and pair rules before crossing. The current runtime supports the two stock avatar profiles and the bundled Downeast boat. Presence remains self-reported presentation state; it does not make vehicle physics authoritative or prevent a modified client from lying about its speed. It does not authorize ownership, driving or teleportation. Appearance styles are the allowlisted `male`/`female` values; all four colors are lowercase six-digit `#rrggbb` strings. Peers cannot supply model paths or materials. Server timestamps avoid relying on synchronized client clocks.
Position is the avatar's feet in signed world coordinates: right-handed, Y-up, meters. Exactly three finite coordinates are required, each within ±100,000 m. Sequence is a JavaScript-safe nonnegative integer and increases within an active session. Yaw is finite and bounded to ±1,000 radians; the client should normalize its accumulated heading. Pitch is finite within ±1.5 radians. Supported modes are `walk`, `swim`, `deck` and `boat`. Protocol `/2` requires a `deck` or `boat` pose to include a finite, nonnegative `vehicleSpeed` in metres per second. The owner rejects vehicle presence unless its signed world explicitly accepts the bundled Downeast boat, contains a compatible berth, the configured avatar-plus-boat complexity fits the signed budget, and the reported speed is within the signed `maxSpeed`. Protocol `/1` remains accepted for walking/swimming clients, but cannot publish vehicle presence. The client also applies the speed cap to local boat physics after portal entry. Presence remains self-reported presentation state; it does not make vehicle physics authoritative or prevent a modified client from lying about its speed. It does not authorize ownership, driving or teleportation. Appearance styles are the allowlisted `male`/`female` values; all four colors are lowercase six-digit `#rrggbb` strings. Peers cannot supply model paths or materials. Server timestamps avoid relying on synchronized client clocks.

The browser should publish at 10 Hz with at most one request in flight, interpolate remote snapshots over approximately 100 ms, hide stalled avatars promptly, remove absent players, and release avatar GPU resources on departure/handoff. Only the active world publishes; preparing a portal destination must not create a player there. On handoff, leave the source, join the destination with the mapped pose, and clear source avatar instances. Open-doorway remote-avatar previews need a separate read-only subscription; publishing the visitor's own state during preview is incorrect.

## Evidence and remaining work

`presence_test.go` exercises two real WebSocket clients through a separate libp2p gateway to an owner, including attempted shared-session spoofing, separate IDs, shared snapshots, explicit leave and disconnect cleanup. It also checks capacity, expiry, rate limits, stale sequences, invalid coordinates and non-owner rejection. `webtransport_integration_test.go` joins over real HTTP/3 WebTransport and then WebSocket, checks that both transports see the same players with separate identities, and checks WebTransport leave.

Live two-browser visual proof, Flip7 rendering, read-only portal presence and owner-failure session recovery remain outstanding. Frame publication, stock avatar rendering and GPU cleanup have targeted automated coverage. The production-connector HTTPS/WSS integration test also joins two sessions, verifies peer poses and departure, then confirms that owner loss and cache recovery do not grant the cache live presence authority. The complete Go suite and focused race checks pass. Client tests cover snapshot isolation, invalid appearances, reordered updates, departures, stale visibility and interpolation. These tests establish publisher and renderer lifecycle behavior; actual connected visual presentation still requires live verification.

## Distance-based avatar detail

Remote avatars select full geometry within 18 metres, medium beyond 18 metres,
and low beyond 45 metres. Returning thresholds are 14 and 38 metres, providing
hysteresis. Distance is measured between local and remote player positions.
Each replacement retains the old mesh until the new one is ready, rejects stale
asynchronous loads and releases the replaced GPU resources. Appearance colors
and the idle/walk/run/helm animation selection remain active at every level.
The generated assets and reproducible Blender workflow are documented in
`tools/blender/avatar-lods.md`; their skeletons, clips, weights and material
structure are checked by `test/avatar-lod-assets.mjs`.

This implements remote-avatar distance LOD only. General world-object LOD,
projected-size selection, portal-view selection, sustained-load adaptation,
and visual transition/animation quality remain requirements in
PROJECT-DIRECTION.md under Later goals.
Textures retain their full resolution at these mesh levels. The signed avatar
complexity cap still rejects over-budget selected geometry rather than choosing
a lower level solely to satisfy the cap.

A live two-browser check exposed premature disposal of a stale character's
textures while mipmap commands remained in the frame encoder. Model cleanup now
waits for submission when an encoder is pending. A regression test verifies
resources remain alive until the submit hook and are released only once.

Local Chrome verification on 2026-10-02 used two independent visitors to an
isolated hosted world at loopback port 5206. The second visitor's
textured avatar appeared, then disappeared on disconnect. Reloading the cleanup
fix produced no additional WebGPU errors in the captured log; earlier errors
remained in the log history. The overlapping default spawn put the camera inside
the other avatar, so this check does not establish full-body animation quality,
near/far visual fidelity or Flip7 performance. Those gates remain open.
