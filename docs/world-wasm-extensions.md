# Signed Wasm world extensions

World behavior extensions are owner-signed content, not trusted browser
programs. A module is accepted only when a signed world document references its
SHA-256 asset ID and the downloaded bytes match that ID. Runtime code must
validate the module again before instantiation.

## Fixed module ABI

- The binary is at most 1 MiB and uses the standard Wasm 1 binary format.
- Imports, tables, and start functions are forbidden. A module has exactly one
  non-shared memory, declares a maximum of at most 64 pages (4 MiB), and
  exports exactly `memory`, `alloc(i32) -> i32`, and
  `run(i32, i32) -> i32`.
- `alloc` reserves input bytes in linear memory. `run` receives a pointer and
  length for a UTF-8 JSON event and returns a pointer to a four-byte little
  endian result length followed by a UTF-8 JSON object.
- Input and output are each capped at 16 KiB. Invalid JSON, out-of-bounds
  pointers, and ABI violations terminate the extension instance.
- Each instance runs in a disposable Web Worker. A run has a default 8 ms
  timeout and a hard configured maximum of 50 ms; timeout terminates that
  worker. Modules receive no imports, WASI, DOM, network, filesystem, or engine
  object references.

The host validates each result against the specific versioned behavior
contract before applying any effect. The module cannot publish presence, alter
signed world data, or perform a network request. A future behavior may expose
additional capabilities only through a separately versioned host contract.

## Implementation status

`src/network/WorldWasmExtension.js` enforces the binary header, module size,
memory maximum, absence of imports/tables/start functions, exact exports, and
function signatures. `WorldWasmExtensionWorker.js` owns compilation, instance
memory, bounded JSON exchange, and the worker termination boundary. Focused
tests cover valid and rejected binary layouts, fixed memory limits, and the
timeout/disposal controller.

World-source and signed-manifest references, browser lifecycle integration,
per-world state, server-side reference validation, and Tidewater/Hogwarts
extension examples remain unfinished. Until those pieces land, the engine does
not claim to load Wasm extensions into a world.
