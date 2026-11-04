# ElseMesh schemas

This directory contains engine-level document schemas and portable component
contracts. The world-source schema validates shared identity, rules, object,
portal, and component envelopes; component payloads remain opaque to the engine.
World-specific component formats and behavior contracts belong in each world's
repository, alongside the source and package assets that use them.

- [`world-source.schema.json`](world-source.schema.json): unsigned authoring
  document structure.
- [`world-proposal.schema.json`](world-proposal.schema.json): hash-bound,
  unsigned source edits.
- [`ai-edit-decision.schema.json`](ai-edit-decision.schema.json): local review
  decisions for AI-generated candidates.
- [`ambient-audio.md`](ambient-audio.md): signed ambience data.
- [`water-body.md`](water-body.md): bounded terrain-independent water.
