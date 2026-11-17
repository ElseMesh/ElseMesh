# Shared movement support kernel

This C ABI module implements the engine's walkable-support height query for
oriented boxes, convex support triangles, and regular-grid heightfields. It is
intended to be the single calculation shared by browser prediction and owner
movement validation. The bridge/provider remains responsible for decoding and
normalizing source collision; the caller still decides whether collision
coverage is complete and whether a missing support result is safe.

The kernel is not yet wired into the browser or `worldd`/HogwartsBridge. Keep
the existing movement gate fail-closed until both sides call this implementation
with the same normalized collision data. This support-only API does not replace
capsule sweeps, contact resolution, or step selection.

## Build in the external build tree

From the ElseMesh external build tree:

```sh
cmake -S native/movement -B native/movement
cmake --build native/movement --target elsemesh_movement elsemesh_movement_support_smoke
ctest --test-dir native/movement --output-on-failure
cmake --build native/movement --target elsemesh_movement_wasm
```

The native shared library and the WebAssembly module are written under the
external build tree. The WebAssembly target requires Clang with a wasm32 target.
See `include/elsemesh_movement.h` for the packed record layouts and C ABI.

The API receives normalized geometry through flat `double` arrays so browser
and server callers can construct identical records without per-shape FFI calls.
The browser should upload the collision snapshot once per region revision and
reuse its WASM memory for frame queries. The native owner path should retain the
same packed snapshot and invoke the same function locally; it must not trust
browser-computed support heights.
