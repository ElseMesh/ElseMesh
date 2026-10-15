# Local world-builder evidence — 15 October 2026

These files come from the running ElseMesh WebGPU app at `127.0.0.1:5191` on the clean feature branch. They are screenshots and raw renderer telemetry, not simulated frames or a hardware qualification. The in-app browser did not expose an adapter name.

## Screenshots

- [Landscape builder and deterministic height preview](landscape-builder-preview.jpeg)
- [Seed 2049 generated island, path and licensed warehouse](generated-island-start.jpeg)
- [Shared authored warehouse computer room after entering from generated island](warehouse-interior.jpeg)

The player used the browser's `W` key to walk from the generated spawn to the warehouse door, then `E` to enter. A real first-run shader pause initially allowed a one-metre interior spawn to fall through the floor. The final branch spawns on the measured collider floor; a second browser walk remained at `(300,18,300)` in walk mode, and `S` then `E` returned to `(4068.8,52.45,4296)`. The browser HUD identified the generated warehouse interior, as shown in the final screenshot. A later browser check confirmed that **Go home** and **Go to landscape** leave the portal inactive and that the generated warehouse can be entered again. The original computer-room geometry and C64 unit tests passed. A fresh end-to-end C64 program execution and video recording were not captured for this branch.

## Short telemetry runs

The browser used balanced graphics at render scale 0.75. We kept **one active rendering tab** during each retained run. Each JSON file contains 20 snapshots at 0.5 s cadence after loading and positioning. `fps` and `cpuMs` are ElseMesh runtime telemetry. The generated start trace has three early shader stalls; its 50.19 FPS median refers to the whole trace, whose steady snapshots are about 49–53 FPS. These data are not per-frame captures or repeated statistical trials.

| Trace | View | Median displayed FPS snapshots | Median CPU ms snapshots | Interpretation |
| --- | --- | ---: | ---: | --- |
| [Builder off](authored-baseline-10s.json) | Authored warehouse `(100,584)`, yaw π | 42.76 | 14.53 | Default URL, no generated world. |
| [Builder on at authored warehouse](home-builder-solo-10s.json) | Same authored view, yaw π, 0 nearby chunks | 42.70 | 14.96 | No measurable gain; short-run difference is not significant. |
| [Generated start](generated-solo-10s.json) | Generated path `(3976,4296)`, yaw −π/2, 49 chunks | 50.19 | 9.14 | Different scene/camera; cannot compare with authored FPS as an improvement. |

The authored baseline camera was set with the existing `monorail.teleport` runtime function from browser diagnostics so it exactly matched the builder's **Go home** button position and yaw. This changed only local browser test state. The builder run used its UI navigation button. Competing renderer tabs produced much lower FPS, so two preliminary traces are retained only in the local worktree's `evidence/` folder and excluded from this table.

`~1.1 MiB` shown in the generated-world HUD is estimated terrain geometry memory, not total GPU memory. The browser reported WebGPU timestamp support, but pass profiling was disabled, so GPU frame/pass time was not recorded. 1% low, p95 frame time, load-time distribution, mobile performance and cross-GPU results are unmeasured. No 2× or other performance gain is claimed.

## Reproduction

Run `npm ci`, then `npm run dev -- --port 5191`; open `http://127.0.0.1:5191/?landscapeBuilder&quality=balanced&scale=0.75`. The default form is the saved seed-2049 sample. Select **Save and explore**, skip the introductory guide, and walk forward to the licensed warehouse. Use **E** at its door to inspect the shared computer room; walk back toward the interior return prompt and press **E**. Save/export JSON and reload to test deterministic reconstruction. The screenshots and traces describe this local branch only; no public deployment was tested.
