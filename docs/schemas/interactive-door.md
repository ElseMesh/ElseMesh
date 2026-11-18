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

## Animation and traversal implementation contract

A usable door definition must bind one owner-authorized state transition to
three effects: the visual door pose, the browser's local collision set, and the
owner's movement sweep. A component that only emits audio or changes an
unrelated boolean is not a traversable door.

The world supplies the stable visual object binding, hinge/pivot transform,
closed and open poses, and the authored transition timing/curve. It also maps
the door to the exact collision sources affected by that motion and states when
those sources stop blocking and become blocking again. Do not infer a hinge,
open angle, duration, or passability threshold from a door name or from its
sound event. Missing or inconsistent visual/collision mappings leave the door
closed and movement fail-closed.

The engine owns a renderer-neutral door runtime. It consumes the signed world
definition and owner-replicated state, drives the shared runtime update path,
and applies the same collision-state transition used by local movement. A
backend adapter may bind the authored object to that runtime, but WebGPU and
WebGL must use the same transform track and passability rule. The browser may
predict the animation for responsiveness; it cannot authorize the state change
or remove the authoritative sweep blocker.

`worldd` validates the interaction and determines the effective transition
time/state. Its movement authority passes that state to the provider's sweep;
the provider resolves the signed door-to-source mapping and ignores only the
door collision sources whose authored passability condition is currently
satisfied. The request must not accept a client-selected list of ignored
colliders. Owner state, provider collision filtering, and browser collision
updates must switch from the same replicated sequence and world-authored
transition rule. Tests must cover closed, opening, passable-open, closing, and
closed-again states, including a forged request that attempts to walk through
the door before it becomes passable.
