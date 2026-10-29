# World behavior rules

Worlds attach bounded JSON data to supported behavior IDs in
`experience.behaviors`. The owner-signed manifest authenticates these values.
The browser validates each behavior's data through its registry and applies it
using client-owned gameplay code. World data cannot add code or call browser,
network, filesystem, or engine APIs.

The shared source schema intentionally treats each behavior's payload as an
opaque object. The server bounds and signs the containing manifest; the client
registry rejects unknown behavior IDs and validates each supported payload
before a runtime consumes it. Behavior-specific authoring contracts belong
with the world content that uses them. Standard behavior implementations
remain part of the trusted client. The extension boundary is restricted to
owner-signed, content-addressed WebAssembly modules under the fixed contract in
[`world-wasm-extensions.md`](world-wasm-extensions.md); downloaded JavaScript
and ambient browser or system APIs are not permitted.

Optional modules are listed in `experience.extensions` as `{ behaviorId,
assetId }` records. The behavior must also be declared in `experience.behaviors`.
The signed manifest carries each module as a `wasm/1` asset, limited to 1 MiB
and `visible` priority. Browser and server manifest validation reject missing
or mismatched asset references. This metadata does not itself activate a
module; the world lifecycle integration remains a separate gate.
