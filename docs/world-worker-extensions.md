# World worker extensions

World-owned behavior code is a signed, content-addressed JavaScript module.
ElseMesh provides a generic dedicated Worker host and a versioned message
transport; the world package defines its events, state transitions, and result
meaning. The engine must not encode Tidewater or another world's event names or
gameplay rules.

## Module and messages

- Each `experience.extensions` entry binds one declared behavior ID to one
  signed asset ID. The manifest lists that asset as `kind: "javascript/1"` with
  `priority: "visible"`.
- The host starts one disposable module Worker for each active world behavior.
  It passes JSON messages only; it does not expose engine objects, credentials,
  renderer instances, or world-server connections.
- Requests and responses use a versioned envelope and have a bounded encoded
  size. The engine validates the envelope and the world-owned behavior module
  validates its event and result data.
- The host allows one outstanding call per worker, applies an execution
  deadline, and terminates the worker on timeout, malformed output, world
  teardown, or explicit disposal. State is private to that world's worker.
- A Worker isolates code from the page DOM and the engine object graph; it is
  not by itself a complete security sandbox. Do not claim network or other
  browser capability restrictions until the browser serving policy enforces
  them.

## Package and ownership boundary

The signed manifest authenticates the module bytes and the browser verifies the
content hash before starting the Worker. World-specific event schemas, gameplay
rules, and tests live in the world repository. ElseMesh owns only the generic
asset verification, Worker lifecycle, message limits, timeout, and teardown
contract. Renderer-independent gameplay remains in the browser; world servers
receive only the authoritative shared state required by the world protocol.

## Implementation status

The source tree still contains the earlier Wasm guard, Wasm asset kind, and
Wasm-specific validation. They must be replaced by the JavaScript Worker
contract above before extensions are activated. No world-specific extension
has been wired into the shared engine gameplay path.
