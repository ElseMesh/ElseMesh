# ElseMesh Babylon.js WebGPU prototype

This is an ElseMesh-level engine experiment, separate from the production
renderer. The common Babylon path uses Babylon's glTF loader and WebGPU engine,
and consumes the same world connector and static-model instance-set contract
used by both worlds. It has two source modes so the same rendering path can be
checked against Hogwarts's local dynamic provider and Tidewater's signed world
gateway.

Install the isolated prototype dependencies with `npm ci` in the matching
external-build copy of this directory, then serve the repository from its
external build tree with Vite. Open this page with either:

- Hogwarts: `?source=hogwarts&localProvider=http://127.0.0.1:<bridge-port>&localMap=SUB_GreatHall_Int`
- A hosted world: `?source=world&worldId=<world-id>&gateway=http://127.0.0.1:<worldd-port>`

The ordinary first pass renders GLB-backed world objects and
`elsemesh.static-model-instance-set/1` components in a 36 m radius, capped at
10,000 placements. A review-only injected ID selection can replay the exact
objects and components from a production snapshot. Babylon handles GLB
scene/material import, WebGPU submission,
and KTX2 decoding; a narrow glTF loader extension resolves ElseMesh's external
texture-asset references through the active connector. Hosted-world manifests
are validated with the same registered world-provider modules as the main
client. Hogwarts mesh sets use their coarse source mesh LOD. The page does not
yet port world-specific runtime components such as Tidewater's water, terrain,
vegetation, village materials, boat, or gameplay, nor ElseMesh collision,
doors, avatars, or live LOD transitions.

The initial Tidewater check loaded its signed manifest and 29 nearby GLB
placements (2.8 MiB of mesh data) through the same Babylon WebGPU path. At the
captured spawn, the view remained mostly empty because its terrain and village
presentation components are not implemented here. This confirms connector,
provider validation, and GLB integration only; it does not show that Babylon
can render Tidewater as a complete world or establish a performance win. Its
observed 17 FPS was one noisy sample with other rendering work on the host.
The initial completed Great Hall load showed about 7–8 FPS with separate
placement clones. That was not a fair comparison with production. A later
matched run is documented in ElseMesh's
[graphics review](../../docs/graphics-review.md#matched-great-hall-webgpu-run).
The prototype now asks Babylon to instance repeated geometry and can use the
production snapshot's object/component IDs and camera pose.
Babylon's KTX2 loader currently uses its default remote decoder module URL;
this prototype does not bundle that decoder yet. An earlier run logged a
resource 404 while the scene still showed some textured geometry. Confirm the
exact decoder response and package or deliberately configure the decoder
before treating KTX2 support as verified or using the prototype offline.

For a meaningful comparison, use the same camera pose, world data, resolution,
and GPU in this page and the production ElseMesh page. Record first-visible
time, CPU/GPU frame time, memory, transfer bytes, GLTF/KTX2 errors, and the
world-specific features that are not represented. Do not recommend a production
migration until both Hogwarts and Tidewater paths render and the cost of their
world-specific component adapters is understood.
