# Completed goals and milestones

Completed items moved out of [PROJECT-DIRECTION.md](PROJECT-DIRECTION.md).
The entries below are limited to milestones whose stated scope is complete;
broader integration and acceptance work remains in the active direction file.

## Engine and content repository separation — 100% (2026-10-22)

- ElseMesh is the engine repository at `https://github.com/ElseMesh/elsemesh.github.io`.
- Tidewater is the separate content repository at
  `https://github.com/ElseMesh/tidewater`, mounted at `worlds/tidewater` as a
  Git submodule pinned to a specific content commit.
- Burning Horizons is maintained independently at
  `https://github.com/ElseMesh/burning-horizons`; it is not included as a
  Tidewater submodule or bundled world in ElseMesh.
- Tidewater is content data, not an independently compiled game. Its content
  is checked out separately and consumed by ElseMesh's world package system.
- `node test/world-content-submodules.mjs` passed on 2026-10-22: the Tidewater
  submodule was pinned, 59 content-addressed assets verified against their
  hashes, source asset links resolved into Tidewater, and Burning Horizons was
  confirmed external.
- `npm run build` passed on 2026-10-22 with the content submodule present.

This records completion of the repository-boundary work. Portable gameplay
parity, multiplayer acceptance, controlled visual comparison, and the graphical
world editor are still active or later goals; see [PROJECT-DIRECTION.md](PROJECT-DIRECTION.md).

The split acceptance was to initialize the Tidewater submodule and build ElseMesh
with the package available, verify imported content hashes and deployment
checkout, and keep Burning Horizons independently cloneable as a separate
two-world fixture. The checks above establish those repository-boundary gates.
The remaining parity and runtime acceptance belongs to the active project
direction. This completed record replaces the former repository split roadmap.

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
