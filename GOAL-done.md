# Completed goals and milestones

Completed items moved out of [PROJECT-DIRECTION.md](PROJECT-DIRECTION.md).
The entries below are limited to milestones whose stated scope is complete;
broader integration and acceptance work remains in the active direction file.

## Engine and content repository separation — 100% (2026-10-22)

- ElseMesh is the engine repository at `https://github.com/ElseMesh/elsemesh.github.io`.
- Tidewater is the separate content repository at
  `https://github.com/ElseMesh/tidewater`, mounted at `worlds/tidewater` as a
  Git submodule pinned to a specific content commit.
- Tidewater is content data, not an independently compiled game. Its content
  is checked out separately and consumed by ElseMesh's world package system.
- `node test/world-content-submodules.mjs` passed on 2026-10-22: the Tidewater
  submodule was pinned, 59 content-addressed assets verified against their
  hashes, and source asset links resolved into Tidewater.
- `npm run build` passed on 2026-10-22 with the content submodule present.

This records completion of the repository-boundary work. Portable gameplay
parity, multiplayer acceptance, controlled visual comparison, and the graphical
world editor are still active or later goals; see [PROJECT-DIRECTION.md](PROJECT-DIRECTION.md).

The split acceptance was to initialize the Tidewater submodule and build ElseMesh
with the package available, verify imported content hashes and deployment
checkout, and build ElseMesh with the package available. The checks above establish those repository-boundary gates.
The remaining parity and runtime acceptance belongs to the active project
direction. This completed record replaces the former repository split roadmap.

## ElseMesh v3 wire and world-ID namespace — complete

- Browser source validation accepts only `elsemesh.world-source/3`; signed
  runtime manifests and browser-host profiles accept only `elsemesh.world/3`.
- Client and daemon world identity validation accepts `elsemesh:<id>` and
  rejects `world:<id>`, the nested `elsemesh:world:<id>` form, `elsemesh-world`,
  and `em-world`. No old-protocol or old-ID compatibility path remains.
- Focused checks passed: `node test/world-identity.mjs`,
  `node --loader ./test/vite-query-loader.mjs test/world-source-manifest.mjs`,
  and `go test -ldflags='-checklinkname=0' ./worldd
  -run '^TestWorldV3RejectsLegacyProtocolAndWorldID$' -count=1`.

This closes the document-wire and world-ID migration only. Engine/world behavior
separation, per-world renderer selection and portal composition, and Tidewater
view/gameplay parity remain active requirements.

## Shared engine touch controls and renderer diagnostics — complete

- Move and look controls are provided once by the ElseMesh engine across
  renderer backends. The vertical look-stick response was corrected to match
  horizontal response; focused touch-control and look-input tests passed.
- Startup reports the selected WebGPU or WebGL backend in the browser console.
  The Vite dev and preview servers now also persist successful game-ready
  reports, including renderer and initial graphics settings, to the ignored
  local file `logs/browser-connections.jsonl`.
- The Vite connection-log endpoint smoke check returned HTTP 204 and wrote a
  valid JSONL record. The synthetic verification record was removed afterward.

These completed supporting tasks are recorded here so the active project goal
stays focused on work that remains.
