# Earlier entry into streamed worlds

## Goal

Let a player enter a remote world as soon as the signed manifest, spawn area,
and minimum entry content are ready. Do not keep the loading screen up until
the whole world, all background assets, or every shader variant is loaded.

The existing world streamer should continue loading visible, nearby, portal,
and background content after the first frame. Portal preparation remains a
separate readiness problem: a portal preview and a crossing must wait for the
destination content needed to render and safely cross that portal.

## Current process and blockers

Remote startup in `src/App.js` currently:

1. Fetches and verifies the world manifest.
2. Sets the signed spawn position.
3. Selects initial objects and components near or visible from the spawn.
4. Downloads all selected assets.
5. Parses and installs those assets and components.
6. Activates the hosted world and presence.
7. Compiles all render pipelines and warms up the GPU.
8. Returns from `App.init()`.

Only then does `src/main.js` hide the loading screen and start the render loop.
The player’s spawn pose is known earlier, but the player cannot be seen or move
until the later gates complete.

The current startup does not always download every manifest asset: the initial
asset ID filter limits the request set. However, it still has several sources of
unnecessary delay:

- startup allows selected assets through `background` priority;
- objects and components without `streamingBounds` are selected immediately;
- large monolithic assets, such as terrain packages, cannot be partially
  downloaded;
- component installation can perform expensive decoding or runtime setup;
- full shader precompilation and GPU warmup happen before rendering starts.

## Entry-ready phase

Define an explicit small bootstrap set required for the first usable frame:

- signed manifest and spawn data;
- collision or ground data for the spawn area;
- immediate visible and nearby geometry;
- required terrain or environment representation;
- global sky, sun, and ambient-light baseline;
- world components explicitly marked as required for entry.

Load and install only this set, then:

1. Activate the hosted world and presence.
2. Start the render loop.
3. Hide the loading screen with world-specific copy indicating that more
   content is loading.

The bootstrap contract must be explicit. Unbounded legacy objects/components
must not silently become startup blockers; give them streaming bounds or move
them into progressive loading. Keep the existing guest and signed-manifest
validation rules intact.

## Progressive phase

After the first frame, keep and extend the existing view-driven streaming:

- load objects visible through the camera;
- load nearby objects next;
- load background content afterward;
- cancel and reprioritize work when the player turns, moves, or changes portal;
- continue loading world components asynchronously;
- preserve hash verification, provider fallback, and bounded concurrency.

The existing `updateWorldStreaming()` loop already performs this work about
every 400 ms. It should remain event/view driven rather than becoming a full
world preload loop.

## Shader startup

Move full shader precompilation and GPU warmup out of the critical entry gate.
Compile only the minimum pipelines needed by the bootstrap scene before the
first frame. Compile remaining variants and perform additional warmup while the
player is already in the world. A first-use stall must be handled by the
progressive loading state rather than preventing all entry.

## Asset-format limitation

Priority labels cannot interrupt one large asset download. Truly early entry
for large worlds requires spatially chunked terrain/structure assets or a small
bootstrap collision/visual representation followed by detailed chunks. Treat
this as a packaging/content-streaming requirement, not only a client scheduler
change.

## Portal behavior

Portal previews and crossings keep their own readiness thresholds. Before showing
a useful preview, fetch the destination manifest and the structures, textures,
lights, and objects visible through the aperture, plus the destination global
environment and dominant light baseline. Show a provisional view when data is
incomplete and refine it as higher-priority destination data arrives. Hold the
player at the threshold until the destination crossing set is ready.

Portal lighting is computed dynamically from the destination scene currently
downloaded and rendered by the client. It is not an authored or signed light
descriptor. Keep any transferred effect local to the doorway and cap its cost
and intensity. Full cross-world shadow maps and global illumination remain
deferred.

## Acceptance checks

- Demonstrate that the player is visible and controllable after the bootstrap
  set completes, before background assets finish.
- Verify delayed background assets continue loading after entry.
- Verify unbounded legacy content no longer blocks entry unexpectedly.
- Verify minimum pipeline compilation permits a usable first frame.
- Verify progressive loading reprioritizes and cancels correctly as the player
  moves.
- Verify portal previews remain provisional until destination data arrives and
  refine progressively.
- Verify portal crossing still waits for its declared destination requirements.
- Verify large monolithic assets are documented as a remaining packaging gate.
- Run focused browser tests and a rendered two-world session; distinguish local
  startup success from independent-network and device acceptance.

## Verified implementation slice (2026-10-20)

- Remote startup now selects unbounded records only through the `nearby` tier
  and preloads the initial asset set through `nearby`; the existing view-driven
  streamer remains responsible for later content.
- Full remote-world shader precompilation and GPU warmup are deferred until
  after the first render-loop frame instead of blocking `App.init()`.
- `node test/world-streaming.mjs` passes, including startup-priority selection,
  cancellation, bounded concurrency, and interrupted WebTransport recovery.
- `node test/webgl-backend.mjs` passes, including WebGPU failure fallback.
- The production build passes in the required external build tree after
  `cpto` synchronization.
- A browser smoke check against the running build reached the playable island
  with automatic WebGL fallback and reported `WebGPU is not available in this
  browser`.

Remaining gates are explicit bootstrap/readiness metadata, a minimum-pipeline
entry pass, spatial chunking for monolithic assets, and a rendered remote-world
test proving that background content continues loading after entry.
