# Bidirectional portal view experiment

Status: **PARTIAL — local, opt-in, not visually qualified or deployed**.

Start the local game with `?portalView` (append `&portalView` if other query parameters are present). Without that flag, the established portal presentation and travel path remain in use. The experiment keeps the existing WebGPU renderer and warehouse geometry. It adds one auxiliary render target and camera, then samples the target on circular meshes in the original island portal and the warehouse return portal. Four animated emissive arcs surround each opening. A generated landscape entrance reuses the same exterior design. Portal travel, the warehouse room, and computer interaction are still handled by the existing system.

The auxiliary camera uses the viewer transform relative to the source portal, rotates it half a turn, and applies it to the destination portal. The renderer draws one direction per frame: warehouse geometry while the player is outside, or exterior geometry while the player is inside. The target has a maximum side of 256 pixels in mobile quality, 384 in balanced quality, or 512 in high quality. It retains the main camera's projection and the viewport aspect. This pass is an additional GPU cost; **no FPS gain is claimed**.

## Known limits and qualification gaps

- The warehouse-to-island view draws opaque island objects and a simplified animated sea plane. It omits the normal ocean refraction, sky and transparent passes, so it is an approximation of the island scene.
- There is no destination-plane clip. Geometry between the mapped camera and destination opening can wrongly obscure the view, particularly at oblique angles or close to an opening.
- The aperture uses screen coordinates to sample the auxiliary target. It is a prototype view, not a fully qualified physically aligned portal.
- The GPU smoke test validates aperture and arc material compilation plus a colored destination visible through a circle. Mapping, arc extent and target sizes have unit tests. Neither test proves the real warehouse or island view appears correctly in the browser.
- Browser portal appearance, two-way parallax, occlusion, interaction alongside preview rendering, GPU cost, and device loss are unmeasured. No genuine two-way browser recording has been captured.
- The portal view owns textures, geometries and a frame buffer and has a disposal method. The current app has no runtime teardown path for the portal owner, so mode-switch lifecycle is not qualified.

## Browser acceptance path

1. On the local branch, open the game with `&portalView` and approach the island warehouse portal. Record a camera move across the opening; check that the warehouse is visible, perspective changes, the electric rim is visible, and interaction still enters the room.
2. From the warehouse, approach the return opening. Record a camera move across it; check the island view, storm rim and successful return.
3. Repeat at close range and oblique angles. Capture the browser console and actual frame-time overlay. Compare against the same scene without `portalView` on the same device and settings.
4. If both views and the return interaction pass, produce two real screen recordings with the two specified camera journeys. Label the island preview's visual simplifications in the evidence.

## Release and rollback

This change is on `experiment/bidirectional-portal`. It does not change the default path. Remove `portalView` from the URL to return to the baseline presentation immediately. The experiment must not be merged or deployed until both views and the performance impact have been measured in the running browser and the visual correctness limits resolved or explicitly accepted.
