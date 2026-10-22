# Burning Horizons behavior inventory

This inventory compares the authored UNDERNEATH and expansion briefs retained
in Burning Horizons with ElseMesh's current `tidewater.world-source/1` package
contract. The briefs are evidence of possible world behavior, not a decision to
adopt every feature or upstream implementation. The content snapshot is
reviewed as world design and assets; its excluded JavaScript runtime is not a
specification for ElseMesh's engine.

## Existing world-data support

The current package can describe static GLB instances, transforms, collision,
movement rules, portals, ambient audio, and a small set of versioned runtime
components. It can configure handlers that already exist in the client. It has
no generic trigger/action graph, world-authored state machine, or procedural
language. Downloaded world content cannot provide executable scripts.

The current UNDERNEATH package already expresses its cave geometry and
collision as assets/data, its ambience as `tidewater.ambient-audio/1`, and
travel through a signed portal. Those parts do not require a new behavior
system.

## Behaviors in the retained design material

| World need described in the content briefs | Can be represented with current content? | Engine work if retained |
| --- | --- | --- |
| Cave passages, landing, closed door appearance, station/platform/interior geometry, props, and static lighting appearance | Yes. Bake geometry/material appearance into GLB; author collision and placement data. | None for static presentation. Door collision can remain closed; animation or opening is behavior. |
| World entrance/exit and transitions between separately hosted areas | Yes. Existing signed portal records cover travel and preview. | None for ordinary portal handoff. Conditional unlocking or animated doors need behavior support. |
| Ambient loops | Yes, with `tidewater.ambient-audio/1`. | None for supported continuous beds. Reactive one-shots, layered event audio, and authored sequencing need behavior support. |
| Cave exploration events such as proximity prompts, giving a key, opening a door, revealing a clue, or updating an objective | No generic representation today. These are not ordinary static objects or portal records. | A reusable, bounded interaction/state/action runtime. A specific new component is also possible, but would hard-code each world mechanic. |
| Reversible monorail shuttle, platform stops, boarding/riding/arrival, and saved route state | No. The engine has a built-in Downeast boat contract, not a generic rail/vehicle framework. | Motion, attachment, stop/board interaction, persistence, and—if shared—authoritative replicated state. A world program can describe its route and parameters only after the engine has safe primitives for these operations. |
| Helicopter flight, key-gated control, pilot lease, and replicated craft state in the retained helicopter brief | No. This is a distinct simulation and multiplayer ownership model. | Flight/controller primitives plus server-validated exclusive control and state replication. It is substantially more than a content-only reshape if actual piloted flight is required. |
| Static fish/animal/character placement | Often. Models can be static GLBs and placements can be data. | None for static presentation. |
| Moving wildlife or marine life | Only for narrowly supported components. Existing wildlife is Example Island-specific; the whale component is a fixed contract, not arbitrary creature behavior. | A portable authored behavior contract or generic bounded simulation primitives for additional species. Shared authoritative wildlife is further work. |
| Terrain, vegetation, wind, weather, surf, and changing lighting | Static terrain/vegetation can be baked or use compatible placement formats. Existing water supports a few named rendering profiles. | Portable weather, world-authored wind/surf simulation, and dynamic day/night or fixture control need explicit runtime support if they are desired. Static appearance can be baked. |

The expansion and helicopter briefs include implementation-status claims from
their source project. This inventory treats their described player-facing
behaviors as candidates only; it does not assume those systems should be copied
or that their state/authority design is suitable for ElseMesh.

## Recommended content-first behavior format

Do not start with a general-purpose downloaded scripting language. Start by
specifying a versioned, declarative behavior document embedded in or referenced
by `world-source.json`. A deterministic state-machine or event/action graph
can express common world interactions while remaining inspectable and
validatable before signing.

The initial vocabulary should be driven by one small target journey (for
example, a key, a locked door, and an unlock/open transition). Candidate
building blocks are:

- bounded triggers such as player enters/leaves a region, interacts with an
  object, or a timer elapses;
- conditions over declared world/session state;
- allowlisted actions such as set a declared state value, show dialogue,
  play a referenced audio asset, toggle a declared object, or start a portal
  transition;
- explicit state scope and reset/persistence rules;
- limits on graph size, action count, timers, movement, and referenced assets.

The document should contain data and references only. Engine code defines the
meaning of every trigger and action, validates bounds, and evaluates it
deterministically. Multiplayer-persistent state must be owned and validated by
the world authority; clients must not decide shared rewards, keys, or vehicle
ownership on their own.

This general interaction layer would cover small authored mechanics without
new engine code for each world. It would not by itself implement new physics
systems such as helicopters or a moving train. Those need reusable engine
simulation primitives, which their world data can then configure. Before
implementing a language, agree on the first world journey and whether its
state is per-player, per-session, or shared/persistent.

## Source references

- Burning Horizons `source/upstream-loz/docs/CAVE-SYSTEM-BRIEF.md`
- Burning Horizons `source/upstream-loz/docs/WORLD-EXPANSION-CONCEPT.md`
- Burning Horizons `source/upstream-loz/docs/THIRD-ISLAND-HELICOPTER.md`
- ElseMesh [`world-authoring.md`](world-authoring.md)
- ElseMesh [`world-source.schema.json`](schemas/world-source.schema.json)
- ElseMesh [`downeast-boat.md`](schemas/downeast-boat.md)
- ElseMesh [`example-island-wildlife.md`](schemas/example-island-wildlife.md)
