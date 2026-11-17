# `elsemesh.interactive-door/1`

This signed world component defines one host-authoritative interactive door.
Its `data` requires a world-space `position` in meters, a bounded
`interactionRadiusMeters`, an explicit `initialOpen` state, and an explicit
`locked` flag. `allowedEntryPointIds` optionally restricts the door to visitors
admitted through those world-authored entry choices. The authority compares
the admitted session's recorded pose and entry choice; client-provided values
do not grant access. An omitted entry allowlist permits any admitted visitor.

Optional `openSoundAssetId` and `closeSoundAssetId` values reference signed
`audio/ogg` assets that must also appear in the component's asset list. The
owner's `world.door.set` request takes a stable component `doorId` and desired
boolean `open` state. It is idempotent: asking for the already-current state
does not create another event. The owner rejects unknown doors, missing or
expired presence, out-of-range visitors, locked opening requests, and entry
choices excluded by the signed definition.

The owner returns the current state set in the `world.door.state` response and
includes it with subsequent presence snapshots. Each transition increments a
door-local sequence and carries an `eventId`; when configured, it also carries
the signed sound asset ID. Clients can discard duplicate sequences and play
the one-shot sound once. Initial state has sequence zero and no event ID.

`worldd` currently implements definition validation, owner authorization,
range and entry-choice checks, idempotent state changes, sound-event IDs, and
state replication. The shared WebGPU/WebGL audio engine now plays a signed
`audio/ogg` event at the component's world-space position when browser audio is
enabled, deduplicating it by world and event ID. The browser's animated
presenter and the atomic link between door state and authoritative collision
are not implemented. A world must not declare this capability as required
until its client can present the door and the movement authority applies the
same state to collision.
