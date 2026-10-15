# Procedural builder release gate — 15 October 2026

Status: **PARTIAL — draft PR #4, not deployed.** Reviewed from `2b904b6baf9f2db2c76dc7a06fffbd598f930bb3`. The ordinary URL must continue to start on the authored island; the builder remains opt-in through `?landscapeBuilder`.

## Isolated production-build preview

From a clean checkout of the PR head, run `npm ci`, `npm test`, `npm run test:landscape-gpu`, `npm run build`, and `npm run verify:release-assets`. Serve the resulting `dist` with `npm run preview -- --host 127.0.0.1 --port 5317 --strictPort`. This loopback origin has separate browser storage from the live Pages origin and cannot publish to Pages. Open `/` and `/?landscapeBuilder`; test reloads and asset URLs on this build, then repeat on a distinct browser profile. The development server is useful for the local 2D-to-3D gallery but is not the release artifact. For a non-default Vite output directory, pass that directory to `npm run verify:release-assets -- <output-directory>` and serve the same directory.

Before a release decision, keep a frozen build of the previous production `main` SHA on a different loopback origin. Alternate baseline and candidate browser runs with the same viewport, quality, render scale, camera path, warm-up, physical GPU and browser. A fixed-camera comparison only qualifies that view. Derive 1% low FPS from the slowest 1% of complete rendered-frame intervals (1000 divided by their mean duration in milliseconds), and retain raw intervals. Report tracked GPU buffer/texture allocation, browser process GPU memory if independently available, and JavaScript heap separately. Do not label heap as GPU memory.

## Required acceptance before merge

| Gate | Evidence required | Current result |
| --- | --- | --- |
| Generated warehouse portal | Normal walking and E interaction into the shared computer room, C64 use, return to the same generated warehouse, home travel, original warehouse visit, and re-entry after edit/restart | Open. Source adapter and unit tests pass; full visible browser journey has not completed. The interior return prompt now names the generated warehouse when appropriate. |
| Portable edits | Place, restart browser, remove, restart, terrain edit/undo, export and import in a fresh second browser, with reconstructed geometry/collision; malformed import preserves prior world | Open. Node tests cover document validation and storage; browser restart and second-browser import remain unproven. |
| Streaming | Declared normal player/vehicle route across positive and negative chunk boundaries, outward/return loops, residency and allocation trend, seam/collision inspection, and near-90 km stress case | Open. Prior scripted camera sweep reached the 49-chunk cap but does not prove ordinary travel. |
| Performance | Matched baseline/candidate rendered-frame intervals, median FPS, 1% low, frame-time percentiles, chunk times and reliable memory categories | Open. The earlier 42.76/42.70 FPS snapshots do not qualify phase 2 or show a gain. Total GPU memory has no established API here. |
| Asset rights and build contents | Checked-in provenance, actual GLB hashes, attribution, and release build free of restricted experiment files | Partially passed. Registry file hashes and rights policy pass tests; `verify:release-assets` checks the built artifact. Upstream warehouse licence page could not be independently re-fetched during this review, so the repository acquisition record remains the evidence. |
| Rollback | Previous production artifact served in staging, candidate saves exported and reopened or safely ignored by old build, documented exact previous SHA and Pages revert procedure | Open. Source-only rollback has not been rehearsed. |
| Final CI and browser acceptance | All required jobs on the final PR head and visible completed output on the production-build preview | Open pending final SHA and browser evidence. |

## 2D-to-3D boundary

The local experiment uses human-authored dimensions and reference metadata to generate a GLB and collision sidecar. It is a parametric interpretation, not automatic photo-to-3D reconstruction. Its registry entry is marked `LOCAL-EXPERIMENT-ONLY`, so the production build now removes the experimental GLB/manifest and does not bundle the gallery module or reference captures. The existing cleared warehouse GLB remains the only placed building adapter for this release.

## Rollback decision

Keep PR #4 draft while any critical gate above is open. Before merging, record the exact previous `main` SHA, export candidate world documents, and rehearse both old and candidate builds on separate preview origins. The deploy workflow can publish on a `main` push or a manual `workflow_dispatch` run on `main`; PR runs skip deployment. If a later release fails, revert the merge against that recorded SHA and verify the resulting Pages workflow and actual visitor path; do not infer recovery from a successful revert command alone.

## Architect gate record

The plan gate was triggered by the cross-component release scope. The architect retained the existing renderer/streamer and single versioned world-document authority, prioritized browser journey and portable edit evidence, identified the restricted experiment files in the built artifact, and required a production-build preview plus rollback rehearsal. The primary removed those files from the release artifact and kept the remaining gates open.

The completion gate reviewed the partial hardening change. It found output-directory ambiguity in the exclusion and verifier, an incomplete description of manual Pages deployment, and the need to record the release hold. The output directory is now derived from Vite's resolved build configuration; the verifier accepts the matching directory; and the deployment text covers both main-push and manual-main cases. The reviewer found no evident regression in the local-only dynamic import or contextual return prompt but did not independently rerun the full suites. Decision: a partial draft-PR update is appropriate; **release completion is not qualified and merge/deployment remain blocked** by the open gates above.
