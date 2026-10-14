# Procedural world test island (experimental)

Status: **PARTIALLY QUALIFIED**. This branch is an opt-in browser experiment. It has not been deployed or tested on mobile hardware.

## Existing architecture and protected area

ElseMesh uses its own WebGPU/WGSL renderer, a CPU `TerrainData` height field, a GPU `TerrainGPU` height function shared by terrain-dependent effects, fixed CDLOD terrain, and browser `GameState` storage. The warehouse, computers, roads, vehicles and existing islands are authored content. The original monorail map is the existing map UI. The portal warehouse is around world `(100, 584)` on the third island. The authored station island extends outside the nominal 2048-metre height grid, so this experiment protects the entire square `|x| <= 1536` and `|z| <= 1536`. The authored terrain and its rendering path stay intact inside that square. The original world remains the default when `?procedural` is absent.

The baseline checkout was `95719848d5ffa4428b57c75c272483e1c2113a72` on `main`. Work is isolated on `codex/procedural-world-test`. No production deployment or remote push was performed.

## Implementation

Add `?procedural` to the local Vite URL. A new game starts at the warehouse exterior. The fixed world seed is `73129`; changing the seed requires a save-version migration. The analytic height function generates sea floor, a shelf, beaches and hilly islands in 1024-metre cells. Cell `(0, 2)` contains the first test island, near `(615, 2515)`. Shared CPU and WGSL implementations allow player ground queries, water-dependent effects and terrain geometry to agree. Generated land uses simple materials and instanced conifer shapes.

The exterior is streamed as 256-metre chunks. Up to 49 chunk slots are resident, two are built per update, and distant chunks use lower geometry resolution (32, 16, or 8 segments). Neighbouring levels share edge samples and use skirts. Unloaded geometry and instances are disposed. There is currently no floating origin, so arbitrary-distance precision and traversal are unqualified.

The existing map opens with `N` and, in this mode, shows world coordinates, a permanent warehouse marker, current position and discovered cells with fog of war. `Y` places a beacon on generated dry land. Up to 64 beacons, discovery and player position are stored under the separate `elsemesh.procedural.v1` localStorage key. This feature does not overwrite the original save format, but normal gameplay in procedural mode still uses the existing game's shared save keys for inventory, vehicles and other progress. The existing helicopter was used for the automated exploration route. There are no new vehicle controls. Navigate to the URL without `?procedural` to return to the original world; switching modes currently reloads the page.

This prototype does **not** persist terrain deformation or arbitrary buildings; the only new player-built modification is a beacon. The generated island uses deliberately simple visual assets and is not a match for authored island detail.

## Tests and measured performance

Browser measurements are from Chrome headless WebGPU on Windows Intel Arc Graphics Xe-LPG at 1280 × 720, balanced quality and 0.75 render scale unless specified. They demonstrate this machine and browser configuration only. In particular, headless render-loop FPS is not a physical display qualification.

| Test | Original | Opt-in procedural | Interpretation |
| --- | ---: | ---: | --- |
| Matched 10-second warehouse render loop, first run | 44.10 average / 20.04 1% low FPS | 44.45 / 20.00 FPS | No material steady-state change |
| Matched 10-second warehouse render loop, repeat | 42.33 / 20.00 FPS | 44.43 / 19.96 FPS | Run-to-run variance; no claimed gain |
| Median / p95 warehouse frame time, first run | 16.8 / 33.5 ms | 16.8 / 33.5 ms | Equal within sample resolution |
| Cold load, first run | 30.10 s | 46.32 s | Opt-in had a slow cold load; compilation/cache effects unisolated |
| Warm load, repeat | 32.04 s | 31.47 s | No reproducible load-time regression from two samples |

The renderer's fixed-view timestamp-query benchmark used 2560 × 1267, balanced quality, 0.75 scale, 60 warm-up and 120 measured frames. Warm baseline versus opt-in median GPU times were: portal loft 39.07 versus 39.18 ms; warehouse port junction 41.35 versus 41.74 ms; village 42.56 versus 41.87 ms. These authored views showed no material GPU change. A first cold baseline portal-loft median of 93.50 ms was excluded from the warm comparison, not hidden. The expansion is a new feature, not a demonstrated FPS optimisation.

In the final controlled browser journey, 49 chunk slots were resident near the generated island and none after returning to the authored area. Generation p95 was 2 ms across 46 samples (max 3.3 ms). The estimated resident terrain geometry was 731,112 bytes. These figures omit trees, textures, engine allocations and driver memory; actual GPU/system memory was not measured. The 10-second warehouse probe measured 1% low FPS and p95 frame time; the exploratory screenshot/video route affected frame pacing and must not be used as a comparable FPS result.

`npm test` passed 77 tests with 1 skipped after the implementation (baseline 71 passed, 1 skipped). `npm run test:procedural` passed six new tests for protection, deterministic reconstruction, chunk edges, save validation, tree resource disposal and failed writes. `npm run test:procedural-gpu` passed nine CPU/GPU height parity points within 0.15 m on the available Dawn GPU. `npm run test:graphics`, `npm run test:renderer`, and `npm run test:architecture` also passed. `npm run build` passed. Final browser checks entered the warehouse loft, opened its C64 terminal, logged in as EXPLORER and ran `PRINT 2+2` with output 4. The journey visited generated terrain, placed a beacon, returned, reloaded, recovered four beacons from accumulated test runs and reconstructed the same generated height (`24.9307708 m`). The refreshed map showed both the home marker and saved beacon after restart. It reported no JavaScript console errors. The browser journey moved the existing free camera programmatically; it is not a human playtest.

A separate controlled browser route used the existing helicopter key, boarding, flight physics, landing and exit actions. It landed on the generated island at `(624, 2547)` with CPU ground height `17.34 m`, exited and reboarded, then landed at home `(114, 638)` and exited. The scripted walk ended `2.16 m` from the warehouse start point. All flight assertions passed with no recorded browser exception. The 46 captured frames form `helicopter-round-trip.mp4`. This is an automated vehicle route, not a human-control playtest; its 10 FPS screenshot HUD reflects forced manual frames and is not an actual performance measurement.

Evidence is stored outside the branch under `C:\Users\Loz\Documents\Codex\2026-10-14\procedural-evidence-v4`, `procedural-flight-evidence-v2`, and the `procedural-fps-*.json` and `procedural-*.json` benchmark files in that date directory. The free-camera journey video is `procedural-browser-journey.mp4` and the existing-vehicle route is `helicopter-round-trip.mp4`. Images and videos depict this test machine, not all supported hardware.

## Known limits and rollback

- No NVIDIA, AMD, Apple Silicon or Android browser run was available. Mobile compatibility is unqualified.
- World scale is deterministic and streamable within validated coordinates, but arbitrary-distance play is not qualified without a floating origin and long-travel tests.
- Generated terrain is lower fidelity, has sparse simple trees, and no generated roads, structures or terrain editing.
- localStorage capacity, save migration and corrupt-save recovery need broader qualification. Save failures show a warning rather than claiming persistence.
- Full driver GPU memory and system memory overhead were unavailable from browser APIs. Only terrain buffer size is estimated.
- The warehouse, vehicle and computer checks are automated and require a human playtest before release.

To roll back the experiment, load the application without `?procedural` or leave this isolated branch. The separate procedural save may be removed with `localStorage.removeItem('elsemesh.procedural.v1')`; this does not undo normal gameplay progress saved under existing keys while the mode was active. Do not publish this branch until gameplay, visual quality, save reliability, device coverage and browser evidence are reviewed and approved.

## Governance gate record

**Plan gate:** Triggered by the multi-component terrain, renderer, map and save work. The architect challenged authored-region boundaries, GPU/CPU height agreement, bounded residency, save versioning, browser vehicle evidence and benchmark validity. The primary chose an additive opt-in exterior, a larger protected square, shared CPU/WGSL height, a separate versioned save, bounded chunks and real browser/Dawn tests. The architect's warning about arbitrary-distance claims remains a stated limitation.

**Completion gate:** Triggered after the initial browser round trip and regression runs. The architect found four material issues: shared tree geometry retained GPU instance buffers across chunk unloads; documentation overstated original-save isolation; the map screenshot lacked the generated island and its `N` toggle could not run while flying; and a failed storage write could still produce a “saved” toast. The primary changed each chunk to own and dispose its tree geometry, added a resource-lifecycle test, narrowed the save claim, changed the failed-save toast, fitted the map to discoveries and allowed the map toggle in helicopter/free-camera modes. The final browser capture confirmed the loft/C64 command, and its map screenshot contains both home and saved beacon without the previous overflow. A separate browser assertion confirmed `N` toggled the map with the helicopter active. Human-control playtesting remains unqualified. The remaining qualification limits above still prevent release.
