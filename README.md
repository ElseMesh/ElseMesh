![ElseMesh — worlds connected by imagination](public/images/elsemesh-splash.png)

# ElseMesh

An experimental WebGPU island exploration game. Walk, sail and fly between
islands, explore the underwater cave and monorail, and collect a sedan delivered
to Bracken Quay by cargo ship. Fishing, trading and hunger are optional.

**[Play the current public build](https://lozknowles.github.io/ElseMesh/)** · **[Track draft cross-world work](https://github.com/lozknowles/ElseMesh/pull/5)**

The requested friend preview requires live travel between independently hosted
worlds. That build is **not available yet**. Draft PR #5 contains the in-progress
federation source and tests, but its current browser integration only shows
signed remote scene proxies in a local development preview. A separate
[preview publisher](https://github.com/lozknowles/ElseMesh-preview) exists,
but its deployment is disabled; its Pages URL is not an available multiplayer
link. See [CHANGELOG.md](CHANGELOG.md) and
[the qualification record](docs/FEDERATION-PHASE2-QUALIFICATION.md) for the
remaining work. Friends can fork PR #5's branch and send a pull request;
direct pushes require collaborator access.

## Ed's focus: prove live cross-world travel

The portal shown in the game video connects places within the existing island
world. It is not evidence that a player has crossed between independently
hosted worlds. Ed's priority is to make that complete journey work in the
actual browser game, using the signed federation work in draft PR #5:

1. Enter a portal from world A and obtain a one-time, owner-signed handoff.
2. Join independently hosted world B under its own owner and session authority,
   then render and control the player's avatar there with other players visible.
3. Return through a portal to world A, including safe recovery if either world
   disconnects or rejects the handoff. Prevent replay or duplicate avatar
   control, and define what happens to carried items.
4. Capture a reproducible browser demonstration and logs showing the two
   separate world services, successful entry and return, and failed/replayed
   handoff handling. Record the exact commit, endpoints, machines and limits.

This is the acceptance target for a friend-ready cross-world preview. The
existing shared room and local remote-scene proxy are useful development steps,
but neither proves that journey. Keep the current public island and draft PR #4
unchanged while this work is tested on PR #5.

This is a public experimental source release, not a finished or fully qualified
game. WebGPU and a capable desktop GPU are required. Frame rate and memory use
vary substantially; port traffic, detailed collision recovery, mobile support
and long multiplayer sessions still need broader testing.

## Run locally

Use Node.js 22.15 or newer (Node 24 recommended).

```sh
npm ci
npm run dev
```

Open the local address printed by Vite. Build with `npm run build`; `npm run
preview` serves the resulting static site. GitHub Pages hosts the single-player
game and local two-window demo. Internet multiplayer needs a separately
configured HTTPS/WebSocket room server; Pages does not host that server.
See [deployment examples](deploy/README.md). The public client and server use
ElseMesh protocol identifiers and environment variables; older invitations and
saved settings from the private prototype are not migrated.

To work on the experimental branch locally, fetch
`feature/network-federation-hardening` from this repository and run the commands
above. This branch and PR #5 remain draft while network and renderer release
gates are open. The procedural builder in draft PR #4 is separate.

## Controls

For reduced ground detail, choose **Settings → Performance → Terrain shading →
Simple**, or open [Simple terrain mode](https://lozknowles.github.io/ElseMesh/?terrainShading=simple).
Full remains the default. The choice is independent of the quality profile and
applies for the current session; the URL flag selects it again after a reload.
Simple preserves terrain shape, collisions, the cave opening and lighting, while
using the existing terrain maps instead of fine procedural surface layers.
Its performance benefit depends on the view and GPU.

An Intel Xe-LPG comparison at 1600×900 output, Balanced quality and 0.75 internal
scale measured 31.62 → 33.20 FPS at the villa and 30.21 → 32.05 FPS at the western
headland. Each result uses two ABBA cycles, with 720 foreground frame intervals
per mode. Separate GPU timestamp runs measured 26.33 → 24.43 ms and
27.56 → 25.26 ms respectively. These are fixed-camera measurements, not phone,
thermal or general gameplay guarantees. Simple is an intentional detail trade-off.

| Input | Action |
| --- | --- |
| WASD | Move |
| Mouse or cursor keys ↑ ↓ ← → | Look up/down and turn left/right |
| Comma / full stop in helicopter | Look through left / right side windows |
| Shift / Space | Sprint / jump |
| E | Interact, board or leave a vehicle |
| WASD / Space / R in car | Drive / brake / recover |
| H | Settings |
| N | Map |
| K | Avatar chooser |
| M | Mute |
| F1 or ? | Full controls |

Cursor-key look works without capturing the mouse. Menus, text fields and the
introductory guide keep their own keyboard controls.

On a phone, use the Move and Look sticks. While piloting the helicopter, hold
**Up** to climb or **Down** to descend. Land on dry ground, stop, release the
controls, then tap **Leave helicopter**. Altitude buttons disappear after exiting.

The cargo sequence can be reviewed with `?view=portCargoDelivery&quality=high&noAudio`.
Its delivery vehicle is MMCWorks' Generic Sedan Car, with separate animated
wheels and collision bounds checked against the actual model.

## Checks

```sh
npm test
npm run test:network
npm run test:security
npm run test:cargo
npm run test:vehicle-steering
npm run test:vehicle-material
npm run test:graphics
npm run test:renderer
npm run test:terrain-quality
npm run test:architecture
npm run test:publication
npm run build
```

Publication checks distinguish generic patterns from an optional private
operator-specific scan. See [portable source and publication checks](docs/publication-portability.md)
for configuration and the separate treatment of build output and Git history.

## Rendering performance

The 2 October renderer update shares scene transforms across passes and skips
unused water-depth and inactive postprocessing work. In a controlled six-view
Balanced test on Intel Arc, average FPS rose from 23.0 to 27.3 (+19.1%) at the
same resolution and quality. Five views improved; village was essentially flat.
This is a fixed-camera result, not a guarantee for gameplay or other hardware.
Long-frame hitches remain, including a worse cargo p99 in this run.
See the [method, limitations and raw evidence](docs/performance-2026-10-02/review.txt).

A follow-up adds distant forest batches, draw-submission reuse and conservative
distant-water optical simplification. A separate six-view comparison with these
switches off/on measured 28.5 to 29.3 FPS (+2.7%), with beach +9.5% and underwater
+7.6%; other views stayed within 1%. CPU submission wall time fell 24%, while
frame-time tails did not improve everywhere. Experimental depth ordering remains
disabled. See the [follow-up evidence and limitations](docs/performance-2026-10-02-stage-two/review.txt).

The architecture update batches nearby animated trees and indexes collision
queries, while fixing FPS reporting to use actual frame intervals. Repeated
forest-villa comparisons measured 15–18% higher FPS, including a camera-and-wind
sweep. A separate loaded-world collision workload returned identical results
with 75% less query CPU time. Other views were noisy and did not establish a
general FPS gain; the tree batches add memory and have a documented motion-history
limit after culling gaps. See the [architecture measurements and limits](docs/performance-2026-10-02-architecture/review.txt).

## Licensing and source

Game code is MIT except `tools/ivy_trial.py` (GPL-2.0-or-later); third-party assets retain their own terms. See [CREDITS.md](CREDITS.md)
and [vehicle credits](public/models/port/CREDITS.md). MMCWorks' sedan is CC BY 4.0.
OpenX traffic assets retain MPL-2.0 AND CC-BY-4.0; their notices and editable
source package accompany the game in [vehicle licensing](public/models/port/licensing/README.md).
Those licences do not grant endorsement or independent vehicle/character trademark rights.

This project's intended use is noncommercial. That intent does not add a new
noncommercial restriction to MIT, MPL or CC BY assets. Permission is being sought
for a separate DeLorean model; that model and its derivatives are excluded here.
The private prototype's Godzilla character asset is also excluded. The rest of
the island game runs without it. No private development history, internal
service configuration, private voice samples or permission correspondence is
included in this repository.

ElseMesh is maintained with Agent Control development assistance.
Original code and asset authorship notices are preserved.
