# Reproducible graphics review

The current ElseMesh build accepts review-camera URL parameters so a view can be opened in a local build or the fork deployment:

- `?view=beach` opens the beach and pier overview.
- `?view=village` opens the beach buildings.
- `?view=tValley` opens the mountain valley and trail approach.
- `?view=tSummit` opens the summit.
- `?pose=<URL-encoded-JSON>` restores a captured pose with `p` (three coordinates), `yaw`, `pitch`, and optional `time`. The shape matches the JSON returned by the existing `window.__pose()` review helper.

These opt-in parameters switch to the existing free camera; they do not affect ordinary launches. Named poses also set a fixed time of day, so lighting is consistent across captures.

The upstream `dgreenheck.github.io/tidewater/` deployment does not include these review-camera parameters. A URL such as `?view=beach` there is ignored, so its spawn view cannot be treated as the same pose as one of the named ElseMesh views. Before calling an image comparison like-for-like, arrange for both builds to use the same camera pose, viewport, time of day, render scale, anti-aliasing, shadows, and water-reflection settings. Otherwise report the mismatch and use screenshots only to identify candidate differences.

## Flip7 hosted grass-density review, 2026-10-23

The current source was served locally from a temporary, loopback-only Example
Island profile. Its signed manifest included the content-addressed
`grass-density/1` mask. Chrome ran on Rebroad scrcpy commit `b59a3d82`'s
persistent display-only virtual display at 720×1600, density 320, CSS viewport
360×696, DPR 2, and render scale 1. Chrome's activity was verified on logical
display 24; captures used only SurfaceFlinger display ID
`11529215048938202412`. The app showed source stamp `a0034d9a`.

Hosted and built-in renders used pose `[62, 7, -62]`, yaw `0.34`, pitch
`-0.12`, and 15:30. Grass is visible on the beach in both frames, so the
hosted package no longer has the complete grass omission seen in the earlier
2026-10-23 comparison. This confirms rendered grass presence with the packaged
mask; it does not establish matching density at every location, LOD behavior,
other views, or sustained performance. The hosted HUD read about 20 FPS and the
built-in HUD about 18 FPS during these captures; these are individual readings,
not performance acceptance results. See the [hosted frame](images/flip7-hosted-grass-village-2026-10-23.png)
and [built-in frame](images/flip7-built-in-grass-village-2026-10-23.png).

## Flip7 hosted-package renderer fix and matched start view, 2026-10-22

The local hosted Example Island initially stayed black. Runtime logs identified
two failures: the hosted static-fish-props component had no `update()` method,
and the terrain shader combined the hosted heightfield with lighting hooks bound
to the built-in heightfield. The update loop now skips optional component update
methods, and hosted terrain activates underwater and ground-bounce hooks bound
to its own terrain GPU module. `TerrainGPU` also binds its configured detail
texture, so packaged and built-in terrain modules agree on that resource.

On the Flip7, Chrome ran only on scrcpy virtual displays at 720×1600, density
420, CSS viewport 274×505, and render scale 1. The hosted world and built-in
world were captured at position [53.6, 4.53, -77], yaw 3.14, pitch -0.05, and
16:12. The hosted app became active and its render-frame counter advanced past
1,700 without the terrain-binding error. Its HUD ranged from 25 to 34 FPS in
the matched capture; readings varied between captures, so this is not a
performance acceptance result. The authored pier, beach, and ocean appear
broadly similar in the two frames. Small material, shadow, and gameplay
differences still need review. See the [hosted frame](images/flip7-hosted-example-2026-10-22.png)
and [built-in frame](images/flip7-built-in-example-2026-10-22.png).

This verifies the hosted Android start view and a matched-pose Android visual
review. Desktop comparison, other island views, gameplay parity, and sustained
performance acceptance remain open. Chrome's player-presence warning about a
closed direct WebRTC channel also remains; the world render itself continued.

## Follow-up browser check, 2026-10-01

The desktop Chrome tab for `https://rebroad.github.io/tidewater/?view=beach` showed a white 3D view while its ElseMesh HUD and performance panel remained active (10 fps, 466 × 295 render size, 50% scale, shadows and water reflections off). The upstream tab completed startup and rendered the beach scene. The two captures used different viewports and the upstream ignored `?view=beach`, so they are not a like-for-like graphics comparison. This differs from the earlier same-day check, which observed both pages rendering. Root cause of the white current view is unknown; inspect fresh renderer diagnostics before attributing it to the world package or making visual changes. The Flip7 had no ADB device, and SSH to its configured `192.168.192.7:8022` endpoint returned `Network is unreachable`.

Record the browser viewport and Performance-tab render scale with each capture: Linux adaptive rendering can lower internal resolution when it misses its 24 FPS target, while the Android path retains its full-quality settings.

## Browser check, 2026-10-01

The Flip7 was not reachable over ADB or SSH during this check, so Chrome on the desktop was used to inspect both deployed pages. Both started and rendered. The upstream page reported 1166 × 683 render size, 100% scale, shadows on, and water reflections on. The fork page at `?view=beach` reported 466 × 295, 50% scale, shadows off, and water reflections off; its URL-selected view worked. The browser tabs had different viewport sizes, and the upstream ignored the named-view URL, so these captures do not establish visual parity. They do confirm that Linux adaptive defaults visibly change rendering settings; those settings are Linux-only in `src/App.js`, with Android excluded by platform detection. A matched camera and viewport comparison remains required before deciding whether scene content or materials regressed.

## Mountain color parity

The island exporter currently writes its 513 × 513 heightfield as a static GLB with hand-authored `COLOR_0` values. That export choice approximates terrain zones; it is not a limit of export or of GLB. Those vertex colors cannot carry the original shader’s layered detail textures, slope-dependent rock, wetness, triplanar rock, or terrain lighting, so drawing that mesh as the final visual surface made the mountain look flatter and differently colored than upstream.

The signed `tidewater.terrain-surface/1` component now carries the deterministic heightfield, baked normal/rock/AO and terrain masks, detail texture, palette, and material parameters. The terrain GLB stays for collision and fallback. The exporter test checks deterministic bytes and the versioned original-terrain material profile. Matched-view screenshots against upstream and Flip7 visual confirmation remain outstanding; see [the terrain export fidelity contract](schemas/terrain-package.md).

## Village texture package

The Example Island package now includes the GPU-baked village PBR maps in its own content-addressed `tidewater.village-materials/2` asset. This removes the prior omission of baked wood, roof, thatch, stone, metal, grime, rope, and net texture inputs. The client regenerates only mip levels from the packaged level-zero bytes and uses the trusted original village shader profile. A matched-camera review of the packaged village against upstream and the Flip7 is still required before claiming visual parity; see [the village material asset contract](schemas/village-materials.md).

## WebGL fallback check, 2026-10-10

The hosted page initially reported `WebGL fallback failed (Cannot read properties of undefined (reading 'WebGLRenderer'))` after WebGPU adapter creation failed. `three@0.180` exposes `WebGLRenderer` as a named ESM export, not a default export. Commit `58f253c` changed the lazy import to use the module namespace and added a regression check. The Pages workflow succeeded, and the live page showed build stamp `58f253c8`; its fallback error changed to `WebGL fallback failed (Error creating WebGL context.)`. That confirms the module import defect is fixed and the renderer constructor was reached. This Chrome session has neither a usable WebGPU adapter nor a usable WebGL context, so it still cannot verify scene rendering. No game click or pointer-lock request was used. The separate `npm run test:webgl-backend` check and production build pass.

## WebGL fallback scene and asset path, 2026-10-11

Commit `40554cf` expanded the fallback scene with terrain colors derived from
the packaged terrain masks and height data, multi-scale terrain detail,
camera-following grass, and packaged vegetation placements. The full client
test suite and Vite production build pass from the external build tree, and
`npm run test:webgl-backend` passes. These checks establish that the fallback
code bundles and backend selection works; they do not show how the scene looks
or performs on an actual WebGL context. Matched-view browser verification is
still outstanding, and the earlier browser session had no usable WebGL
context. The optional Blender worker runtime test was also attempted but
could not enter its Bubblewrap namespace in this container; it remains
unverified here.

## Flip7 virtual-display smoke check, 2026-10-10

The deployed `https://elsemesh.github.io/` page was opened in Chrome on the
scrcpy virtual display only (logical display 29, 720×1600; SurfaceFlinger ID
`11529215050196523144`). The start page advanced into the playable island after
a tap explicitly sent to display 29. The resulting view showed the pier, beach,
ocean, HUD, touch controls, and commit badge `e9399014`; the HUD reported
29 FPS. No white-texture failure appeared in that view. This verifies a
single start-area renderer smoke check on the phone. It does not verify the
mountain, trail, village, seabed, boat, LOD transitions, or visual parity.

The original `https://dgreenheck.github.io/tidewater/` page was opened on the
same virtual display and viewport. It initially showed shader compilation at
38%; after loading, it reached its playable pier start view. The two views
show broadly similar pier, beach, and ocean materials, with no white-texture
failure in the ElseMesh view. The current HUD read 29 FPS and the original read
23 FPS at capture time. This is an approximate start-view comparison only:
camera pose, time, exposure, and render settings were not captured precisely
enough to call it a controlled match or sign off on visual parity. The retained
captures show the [current playable scene](images/flip7-virtual-current-2026-10-10.png)
and the [original playable scene](images/flip7-virtual-baseline-playable-2026-10-10.png).
Neither physical Flip7 display was targeted.

## Direct unlisted gateway on Flip7, 2026-10-11

The current hosted client was opened with a direct Example Island invite through
an unlisted Cloudflare Quick Tunnel to the local `thruholdd` gateway. The public
`/healthz` endpoint returned HTTP 200. No gateway was published to the Worker
directory or DHT; the random Quick Tunnel URL was shared directly for this
test and was not added to project documentation or discovery. The tunnel is
temporary, has no uptime guarantee, and anyone who obtains its URL can reach
the gateway and served content.

Chrome ran only on scrcpy virtual display 30 (720×1600; SurfaceFlinger ID
`11529215048683042661`). The initial invite reached the hosted loading page,
then the playable pier view. The on-screen stamp `8340dfcd` matched the
`main` HEAD at capture time, and the HUD reported about 54 FPS. The pier wood,
beach, and water rendered without the earlier white-texture failure. The
captured view is available at
[the Flip7 direct-gateway screenshot](images/flip7-unlisted-direct-gateway-2026-10-11.png).

This verifies one public HTTPS/WSS gateway path and the start area on one
device. It does not establish an independent-network/NAT test, relay or WebRTC
fallback, portal traversal, matched visual parity against the original, or
persistent gateway availability. A desktop Chrome attempt remains unable to
create either a WebGPU adapter or WebGL context, so it could not render the
scene. During the first phone launch attempt, shell handling split the invite
URL at its `&` separators; quoting the complete remote `am start` command fixed
the test invocation. No source change was needed for that issue.
