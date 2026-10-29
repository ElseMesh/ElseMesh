# World extensions

World extensions are signed, content-addressed WebAssembly modules declared in the signed world manifest. A descriptor uses protocol `elsemesh.world-extension/1`, references one `application/wasm` asset, binds to one declared behavior ID, selects a memory ceiling from 1 to 256 WebAssembly pages, and lists up to 16 capability labels. Each behavior may bind to at most one extension.

The browser runs each module in its own Worker. The module may import only the host-provided `elsemesh_host_v1.memory`, and must export exactly `abi_version`, `alloc`, `init`, `memory`, `output_len`, and `step`. `abi_version()` returns `1`. `init(inputPointer, inputLength)` and `step(inputPointer, inputLength)` return a pointer to a UTF-8 JSON object in linear memory; `output_len()` returns its byte length. `alloc(length)` returns a writable pointer. The module may use it to reserve input and output scratch space for one call; `output_len()` must report the result length and reset that scratch allocator for the next call. The host copies the output before making another allocation. Inputs and outputs are limited to 64 KiB. Modules are limited to 8 MiB. Each step has a 50 ms wall-clock deadline, and each extension is limited to 250 ms of aggregate step wall time in each 60-second accounting window. The host terminates a failed, late, or over-budget module. Wall time includes browser scheduling delay, so this is a conservative availability bound, not a deterministic instruction or fuel quota; termination latency still depends on browser scheduling.

The step budget is per extension and its accounting window starts when that extension loads; with at most eight extensions, the configured aggregate is at most 2 seconds of counted step wall time per minute. The ABI has no DOM, network, filesystem, WASI, rendering, input, or engine imports. Modules cannot define private memories or tables; all linear memory is the host-created memory bounded by the descriptor at 1–256 WebAssembly pages (64 KiB each). With at most eight extensions per world, declared linear memory is capped at 128 MiB total, excluding Worker/runtime overhead. Capability labels must be allowed by the bound behavior's client registry entry; they are still metadata only, and the client grants no extension APIs today. The host retains the latest JSON state returned by each extension and passes updates to the registered world behavior handlers. Only behavior IDs the client already supports can consume that state; an extension cannot install arbitrary runtime behavior by itself.

The Chromium/WebRTC integration test also runs a real Wasm module with an
infinite `step` loop and verifies that the browser host observes its deadline
and calls `Worker.terminate()`. This covers actual browser-worker termination,
in addition to the focused host timeout tests.

`elsemesh.world-extension/1` must appear in `rules.requiredFeatures` whenever the extension list is non-empty. Clients that do not support the feature reject the world instead of silently skipping its extension behavior.

The registered `elsemesh.fishing-game/1` behavior accepts only
`{ "biteRateMultiplier": number }` from its bound module, with a value in the
range 0.5–2.0. It applies that multiplier to the local browser's wait between
bites; it does not change bite phases, fight physics, presence, or server state.
Tidewater's `fishing-rhythm.c` module selects a faster waiting rate at dawn and
dusk and a slower rate at night. WebGPU and WebGL use the same
`FishingGameRuntime` consumer, so the authored rule has the same gameplay effect
on either renderer. Rebuild its content-addressed asset with
`node worlds/tidewater/tools/build-fishing-rhythm-wasm.mjs` after editing the C
source, then update its hash in `world-source.json` and regenerate the asset
index.
