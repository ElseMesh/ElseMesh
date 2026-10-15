# Bidirectional portal view experiment

Status: **PARTIAL — local, opt-in, scripted browser demonstration verified; not release qualified or deployed**.

Start the local game with `?portalView` (append `&portalView` if other query parameters are present). Without that flag, the established portal presentation and travel path remain in use. The experiment keeps the existing WebGPU renderer and warehouse geometry. It adds one auxiliary render target and camera, then samples the target on circular meshes in the original island portal and the warehouse return portal. Eight animated emissive arcs surround each opening. A generated landscape entrance reuses the same exterior design. Portal travel, the warehouse room, and computer interaction are still handled by the existing system.

The auxiliary camera uses the viewer transform relative to the source portal, rotates it half a turn, and applies it to the destination portal. The renderer draws one direction per frame: warehouse geometry while the player is outside, or exterior geometry while the player is inside. The target has a maximum side of 256 pixels in mobile quality, 384 in balanced quality, or 512 in high quality. It retains the main camera's projection and the viewport aspect. This pass is an additional GPU cost; **no FPS gain is claimed**.

## Known limits and qualification gaps

- The warehouse-to-island view draws opaque island objects and a simplified animated sea plane. It omits the normal ocean refraction, sky and transparent passes, so it is an approximation of the island scene.
- There is no destination-plane clip. Geometry between the mapped camera and destination opening can wrongly obscure the view, particularly at oblique angles or close to an opening.
- The aperture uses screen coordinates to sample the auxiliary target. It is a prototype view, not a fully qualified physically aligned portal.
- The GPU smoke test validates aperture and arc material compilation plus a colored destination visible through a circle. Mapping, arc extent and target sizes have unit tests. Neither test proves the real warehouse or island view appears correctly in the browser.
- The two scripted browser views are verified. General two-way parallax, oblique occlusion, GPU cost, and device loss remain unqualified. Two genuine canvas recordings now exist; see the evidence section below.
- The portal view owns textures, geometries and a frame buffer and has a disposal method. The current app has no runtime teardown path for the portal owner, so mode-switch lifecycle is not qualified.

## Browser acceptance path

1. On the local branch, open the game with `&portalView` and approach the island warehouse portal. Record a camera move across the opening; check that the warehouse is visible, perspective changes, the electric rim is visible, and interaction still enters the room.
2. From the warehouse, approach the return opening. Record a camera move across it; check the island view, storm rim and successful return.
3. Repeat at close range and oblique angles. Capture the browser console and actual frame-time overlay. Compare against the same scene without `portalView` on the same device and settings.
4. If both views and the return interaction pass, produce two real screen recordings with the two specified camera journeys. Label the island preview's visual simplifications in the evidence.

## Release and rollback

This change is on `experiment/bidirectional-portal`. It does not change the default path. Remove `portalView` from the URL to return to the baseline presentation immediately. The experiment must not be merged or deployed until both views and the performance impact have been measured in the running browser and the visual correctness limits resolved or explicitly accepted.


## Scripted coconut demonstration — 15 October 2026

The opt-in panel provides **Watch from warehouse**, **Watch from island** and **Stop demo**. A single local monkey walks towards the original Island 3 entrance and throws one coconut at the currently selected avatar, staged inside the warehouse. Both buttons replay the same bounded simulation with different observer cameras. The avatar is the existing loaded player mesh, not a replacement. No saved world changes or deployment are performed.

The projectile uses swept portal-plane crossing with radius clearance, rigid position/velocity mapping and the remaining time step. A simple chest sphere and floor plane provide contact/bounce/settling; this is not general world-object physics or autonomous monkey behaviour. Rendering selects the observer side independently of the player's room membership, and includes dynamic avatar/coconut meshes. The island preview owns separate terrain LOD buffers so the main camera cannot cull away the portal's ground. The rim uses animated jagged emissive arcs.

### Evidence

Local artifacts under `artifacts/portal-coconut/`:

- `warehouse-to-island.mp4`: actual WebGPU canvas capture, 404 x 1724, 13.728 seconds, 1,847,679 bytes.
- `island-to-warehouse.mp4`: actual WebGPU canvas capture, 404 x 1724, 13.628 seconds, 2,467,668 bytes.
- Original VP9 WebM recordings, both views' screenshots, event JSON, encoded-frame contact sheets, test/build logs and `restore-check.json` retained beside them.

Recordings used the in-app browser's normal narrow viewport, balanced quality, scale 0.75 and temporary manual daylight (15:00). Each run was captured for approximately 14 wall-clock seconds using `canvas.captureStream(30)` and MediaRecorder, then transcoded to H.264 without interpolation. Their encoded cadence is roughly 13-14 frames/second, **not a game FPS benchmark**. The canvas recording excludes DOM HUD elements; screenshots retain the actual HUD. No matched baseline or GPU-cost claim is made.

Encoded frames were inspected across approach, wind-up, release, crossing, avatar contact and landing. The coconut is small within the low-resolution portal view and has visible temporal trailing; avatar contact is clearer from the warehouse camera. The island preview has simplified sea/sky lighting and some sign-back occlusion. These remain prototype visual limitations, not a release-quality portal qualification.

The recordings preceded only the asynchronous replay cancellation/grounded-state restoration fix; simulation, geometry, trajectory and camera poses are the same. Final browser verification exercised two concurrent replay requests followed by Stop: position `[3976,46.44466397422977,4296]`, outside state, free-camera false and 164 scene children were restored exactly. A final island replay was left open for the user with temporary daylight; Stop restores the player state, and reloading restores normal time settings.

### Architect gates

- PLAN: separate terrain selection buffers required because restoring shared buffers before GPU submission would corrupt the main/auxiliary passes. Adopted independent portal terrain selection and shared immutable terrain data.
- PLAN extension: observer side must be independent of avatar location; use dynamic mesh membership and swept position/velocity transfer. Adopted.
- COMPLETION: architect found overlapping starts awaiting avatar load could leak actors and overwrite saved state. Added cancellation generations and regression tests; Stop cancels pending starts. Live overlapping-start/stop restoration passed. Architect also required encoded-video inspection, completed as described above.

Remove `portalView` to disable the entire experiment. Stop removes its monkey/coconut and restores the previous player/camera state. The unchanged production deployment remains the rollback target; no merge or deployment was made.

Final validation: npm test completed with 120 passed, 2 skipped, 0 failed, plus the preceding script-based checks and WebGPU smoke tests. npm run build passed with the existing LocalLights mixed-import warning. No matched performance benchmark or cross-device qualification was performed.

Completion re-review accepted the scoped local demonstration after independently rerunning all 9 focused tests and reviewing restoration evidence, encoded contact sheets and the test/build logs. General portal release qualification remains PARTIAL.

## Monkey follows the coconut — 15 October 2026

The same replay now continues after the throw. At simulation time 7 s the monkey returns its throwing arm to the walking gait, climbs a temporary approach ramp, crosses the opening and walks down into the warehouse, finishing near the existing avatar at 13 s.

One deterministic actor trajectory drives two persistent render representations. Each material clips against its own portal plane in color and shadow passes, so the head, body and tail cross progressively instead of teleporting the whole monkey. The destination representation belongs to the interior render set throughout. The aperture frame now matches its rendered plane exactly. Temporary ramps accommodate the unequal floor heights, and lowering starts only after tail clearance. Stop removes both representations, four walkway meshes and the coconut, restoring player/camera state. The original world geometry is unchanged.

Evidence: `artifacts/portal-monkey-walk/island-view.mp4` (21.549 s) and `warehouse-view.mp4` (21.349 s) are actual 464 x 1724 browser-canvas recordings, captured independently using the two replay buttons. Both were decoded and inspected across the crossing. Events show one monkey crossing and one arrival per replay. `restore-check.json` records live browser cleanup checks before, during and after crossing (simulation times 0, 10 and 14): player position, room membership, free-camera state and scene object count were restored. Time was staged only for those cleanup checks, not for the videos.

Validation: npm test 121 passed, 2 skipped, zero failed; preceding script checks and WebGPU smoke passed; build passed. The new GPU check verifies monkey material compilation and visible versus fully clipped color output. Unit coverage verifies mapped trajectory agreement and final floor height. Shadow clipping and individual foot contact on ramps are not independently pixel-qualified. This remains scripted locomotion, with existing low-resolution portal visibility and temporal trailing limitations.

Architect PLAN required clipped halves, matched portal planes, aperture clearance, throw-arm recovery and delayed floor settling; implemented. COMPLETION accepted the implementation with two remaining evidence items (island crossing inspection and active Stop/replay cleanup); both were subsequently verified as above. This establishes a local demonstration, not networking or multi-machine world transfer. No production merge or deployment.
