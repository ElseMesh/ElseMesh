# World behavior rules

Worlds attach bounded JSON data to supported behavior IDs in
`experience.behaviors`. The owner-signed manifest authenticates these values.
The browser validates each behavior's data through its registry and applies it
using client-owned gameplay code. World data cannot add code or call browser,
network, filesystem, or engine APIs.

The fishing behavior accepts an optional `biteRateSchedule` with a
`defaultMultiplier` and at most 16 sorted, non-overlapping `windows`. Each
window has `startHour`, `endHour`, and `multiplier`. Hours use 0.1-hour
increments on a 24-hour clock. At runtime, the current hour is wrapped to
0–24, then truncated to the lower 0.1-hour value before matching. A window
includes its start and excludes its end. Multipliers must be between 0.5 and 2.
The shared fishing runtime applies
the selected rate only while waiting for a bite; taking a fish and fighting it
use their existing gameplay rules.

Worlds without a schedule keep the neutral 1.0 rate.

Add new behavior data only when it can be represented by a small validated
schema and consumed by a behavior already implemented by the client. The
client rejects unknown behavior IDs and invalid data rather than interpreting
arbitrary expressions.
