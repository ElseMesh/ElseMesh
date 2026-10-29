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
with the world content that uses them, while executable behavior code remains
part of the trusted client.
