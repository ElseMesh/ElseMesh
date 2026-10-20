# Second Life streaming references

This note records open-source projects downloaded for comparison while
developing ElseMesh streaming. They are reference implementations for network
protocols, request scheduling, caching, and level-of-detail policy. ElseMesh
continues to render in the browser with WebGL/WebGPU; these native viewers are
not rendering dependencies.

## Local checkouts

The source trees are under `/home/rebroad/src` and were downloaded as filtered,
single-revision checkouts on 2026-10-20:

| Project | Local path | Revision | License | Use in the comparison |
| --- | --- | --- | --- | --- |
| [LibreMetaverse](https://github.com/cinderblocks/libremetaverse) | `/home/rebroad/src/libremetaverse` | `befa9a72c1ed` | BSD-3-Clause | Protocol, asset/model formats, examples, and transport throttling |
| [OpenSimulator](https://github.com/opensim/opensim) | `/home/rebroad/src/opensim` | `0c07b35f8e20` | BSD | Region, capability, asset-service, and range-response behavior |
| [Second Life Viewer](https://github.com/secondlife/viewer) | `/home/rebroad/src/secondlife-viewer` | `f47a45343092` | LGPL-2.1 | Mature client-side texture/mesh queues, HTTP priorities, and cache behavior |
| [Alchemy Viewer](https://github.com/AlchemyViewer/Alchemy) | `/home/rebroad/src/alchemy` | `4f70880750d2` | LGPL-2.1 | Current third-party viewer comparison and practical tuning |

These repositories have clean working trees. They have not been built, and no
ElseMesh source code depends on them.

## Relevant implementation points

- The official viewer's `indra/llcorehttp/_httpreadyqueue.h` implements a
  priority-ready queue for HTTP operations.
- `indra/newview/lltexturefetch.cpp` tracks image priority and can reprioritize
  or abort work as the requested visual size changes.
- OpenSim's `Capabilities/Handlers/GetTexture/GetTextureHandler.cs` and
  `GetMesh/GetMeshHandler.cs` show server-side asset lookup, format selection,
  caching, and byte-range mesh responses.
- LibreMetaverse's `LibreMetaverse.Transport/UdpThrottle.cs` separates task,
  texture, and asset traffic into independently rate-limited categories while
  leaving control packets unthrottled.

## What ElseMesh should take from this

The useful browser-side patterns are:

- maintain explicit bootstrap, visible, nearby, portal-preview, and background
  work classes;
- compute priority from camera visibility and projected size, then update it as
  the camera or player moves;
- cancel stale requests and avoid allowing low-priority work to occupy the
  entire concurrency budget;
- keep immutable, hash-addressed assets in a persistent browser cache;
- support bounded byte ranges where an asset format permits progressive access;
- use small preview or low-detail assets before detailed geometry;
- keep control/presence traffic independent from bulk asset traffic.

These patterns complement ElseMesh's existing signed manifests,
`streamingBounds`, priority ranks, content hashes, bounded range requests, and
browser-side GLB/LOD installation. They do not justify adopting LLUDP,
Second Life UUID asset identity, native C++ rendering, or OpenSim's server
authority model.

## License and reuse boundary

The licenses above apply to the respective repositories and do not grant
permission to copy arbitrary code into ElseMesh without review. Any future
reuse must identify the exact file, preserve required notices, and confirm that
the resulting browser bundle and repository remain compatible with ElseMesh's
license and distribution model.
