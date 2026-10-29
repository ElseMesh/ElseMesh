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
- Modules are self-contained and cannot use JavaScript `import` syntax; imported
  code would not be covered by the module asset's content hash.
- The host starts one disposable module Worker for each active world behavior.
  At startup it sends one `initialize` request containing that behavior's
  signed JSON data. It passes JSON messages only; it does not expose engine
  objects, credentials, renderer instances, or world-server connections.
- Requests and responses use the `elsemesh.world-extension/1` envelope and
  have a bounded encoded size. The engine validates the envelope and the world-owned behavior module
  validates its event and result data.
- The host allows one outstanding call per worker, applies an execution
  deadline, and terminates the worker on timeout, malformed output, world
  teardown, or explicit disposal. State is private to that world's worker.
- The host exposes the initialization result as `ready(behaviorId)` and will
  not dispatch later events to that worker until initialization succeeds.
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

The engine and publisher use the signed `javascript/1` asset kind and a
dedicated Worker host. JavaScript module bytes are UTF-8 checked and bounded;
startup and each call have a deadline, and message payloads are size-limited.
WebGPU and WebGL world activation create, expose, and dispose the generic
runtime through behavior registry contexts. The Tidewater package is its first
consumer: its signed fishing rules module receives the authored schedule during
Worker initialization and returns the rate table used by both renderer paths.
The engine also accepts an otherwise unknown behavior ID only when the signed
experience binds it to a Worker extension, allowing a world package to define
its own behavior contract. The rest of the world-owned gameplay migration
remains open.
