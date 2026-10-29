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
remain part of the trusted client. Optional world-owned JavaScript extensions
run in dedicated browser workers with a message-only interface; their module
and lifecycle contract is described in
[`world-worker-extensions.md`](world-worker-extensions.md). The engine does
not provide world-specific events or gameplay rules.

Optional modules are listed in `experience.extensions` as `{ behaviorId,
assetId }` records. The behavior must also be declared in `experience.behaviors`.
The signed manifest carries each module as a `javascript/1` asset with
`visible` priority. Browser and server manifest validation reject missing or
mismatched asset references. The engine owns the generic worker and lifecycle;
the world package owns module behavior and its event vocabulary.
